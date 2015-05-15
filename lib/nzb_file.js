var Blast = __Protoblast,
    Str = Blast.Bound.String,
    Fn = Blast.Bound.Function,
    PassThrough = require('stream').PassThrough,
    libpath = require('path'),
    Yencer = require('yencer'),
    fs = require('fs'),
    NzbFile;

/**
 * The NzbFile class: a wrapper for a file entry inside an NZB
 *
 * @author   Jelle De Loecker   <jelle@kipdola.be>
 * @since    0.1.1
 * @version  0.1.3
 *
 * @param    {NzbDocument}   parent
 * @param    {Object}        filedata
 */
NzbFile = Fn.inherits('Informer', function NzbFile(parent, filedata) {

	var that = this;

	// The parent NZB document
	this.nzb = parent;

	// The nitpin instance
	this.server = parent.server;

	// The data of this file
	this.data = filedata;

	// The filename
	this.name = filedata.filename;

	// The segments (usenet articles)
	this.segments = filedata.segments;

	// The amount of downloaded segments
	this.finishedSegments = 0;

	// The suborder (like a rar-part file)
	this.suborder = 0;

	// The getBody jobs
	this.jobs = [];

	// Has the download finished?
	this.downloaded = false;

	// Is there a repaired file available
	this.repaired = null;

	// Did this file contain corrupted pieces
	this.corrupted = null;

	// Extract some more information
	this.triage();

	// The deyenc queue
	this.yenqueue = parent.yenqueue;

	// The file/segment queue
	this.filequeue = parent.filequeue;
});

/**
 * Prepare the downloadsize of this nzb
 *
 * @author   Jelle De Loecker   <jelle@kipdola.be>
 * @since    0.1.4
 * @version  0.1.4
 *
 * @type     {Number}
 */
NzbFile.prepareProperty(function downloadsize() {

	var bytes = 0,
	    i;

	for (i = 0; i < this.segments.length; i++) {
		bytes += this.segments[i].bytes;
	}

	return bytes;
});

/**
 * The current progress percentage as a getter property
 *
 * @author   Jelle De Loecker   <jelle@kipdola.be>
 * @since    0.1.3
 * @version  0.1.3
 *
 * @type     {Number}
 */
NzbFile.setProperty(function progress() {
	return ~~((this.finishedSegments / this.segments.length) * 100);
});

/**
 * Debug method
 *
 * @author   Jelle De Loecker   <jelle@kipdola.be>
 * @since    0.1.3
 * @version  0.1.3
 */
NzbFile.setMethod(function debug() {

	if (!this.server.debugMode) {
		return false;
	}

	return this.server.debug('__debug__', 'NZBFILE', arguments);
});

/**
 * Abort the download.
 * Already made requests will not be aborted.
 *
 * @author   Jelle De Loecker   <jelle@kipdola.be>
 * @since    0.1.3
 * @version  0.1.3
 */
NzbFile.setMethod(function abort() {

	var aborted = 0;

	// Cancel all the jobs
	this.jobs.forEach(function eachJob(job) {
		if (!job.executed && !job.cancelled) {
			abort++;
			job.cancel();
		}
	});

	if (aborted) {
		this.emit('aborted', aborted);
	}
});

/**
 * Pause the download.
 * Already made requests will not be aborted.
 *
 * @author   Jelle De Loecker   <jelle@kipdola.be>
 * @since    0.1.3
 * @version  0.1.3
 */
NzbFile.setMethod(function pause() {

	var paused = 0;

	// Cancel all the jobs
	this.jobs.forEach(function eachJob(job) {
		if (!job.executed && !job.cancelled && !job.paused) {
			paused++;
			job.pause();
		}
	});

	if (paused) {
		this.emit('paused', paused);
	}
});

/**
 * Resume the download
 *
 * @author   Jelle De Loecker   <jelle@kipdola.be>
 * @since    0.1.3
 * @version  0.1.3
 */
NzbFile.setMethod(function resume() {

	var resumed = 0;

	// Cancel all the jobs
	this.jobs.forEach(function eachJob(job) {
		if (!job.executed && !job.cancelled && job.paused) {
			resumed++;
			job.resume();
		}
	});

	if (resumed) {
		this.emit('resumed', resumed);
	}
});

/**
 * Triage the file
 *
 * @author   Jelle De Loecker   <jelle@kipdola.be>
 * @since    0.1.1
 * @version  0.1.2
 */
NzbFile.setMethod(function triage() {

	var filename = this.name,
	    temp,
	    pars = this.nzb.pars,
	    rars = this.nzb.rars;

	// Handle parchives
	if (Str.endsWith(filename, '.par2')) {

		this.parchive = true;

		if (filename.indexOf('.vol') == -1) {
			pars.main = this;
		} else {
			pars.others.push(this);
		}

		return;
	}

	// Handle rar files with the .rar extension
	if (Str.endsWith(filename, '.rar')) {

		// Look for "part#" in the name
		temp = /\Wpart(\d+)\.rar/.exec(filename);

		if (temp) {
			// These part files start at number 1 for the first file
			this.suborder = Number(temp[1]) - 1;
		} else {
			// No "part#" found, is probably the first one
			this.suborder = 0;
		}

		// Push it to the others
		rars.others.push(this);

		return;
	}

	temp = /\.r(\d\d)$/.exec(filename);

	if (temp) {
		// These part files start at 0 for the SECOND part (first part has no number)
		this.suborder = Number(temp[1]) + 1;
		rars.others.push(this);
	}
});

/**
 * Create a stream to the file
 *
 * @author   Jelle De Loecker <jelle@kipdola.be>
 * @since    0.1.1
 * @version  0.1.3
 *
 * @param    {Number}   stream_weight      Higher weights get priority
 * @param    {Boolean}  ignoreCorruption
 */
NzbFile.setMethod(function stream(stream_weight, ignoreCorruption) {

	var that = this,
	    tasks = [],
	    orderTasks = [],
	    informer = new Blast.Classes.Informer(),
	    written = 0,
	    corrupted,
	    lastPart,
	    stream;

	if (ignoreCorruption) {
		that.debug('Created filestream for repairing', that.name);
	} else {
		that.debug('Created filestream', that.name);
	}

	if (this.parchive) {
		ignoreCorruption = true;
	}

	// Amount of corrupted/missing segments
	corrupted = 0;

	// The passthrough stream
	stream = new PassThrough();

	if (!stream_weight) {
		stream_weight = 10;
	}

	// Prepare the fetching of all the file segments
	this.segments.forEach(function eachSegment(segment, index) {

		var yfile,
		    fbuffer,
		    cachehit = false,
		    weight = 200000 * stream_weight;

		// Subtract the suborder
		weight -= (that.suborder * 1000);

		// Subtract the segment index
		weight -= (index * 10);

		// Queue the task that gets the actual segment
		that.filequeue.add(function getSegment(nextSegment) {

			var tempFilePath,
			    body;

			Fn.series(function getCache(next) {

				// Try to get the segment from the temp folder
				that.nzb.getTemp(function gotTempPath(err, temppath) {

					if (err) {
						return next();
					}

					tempFilePath = libpath.resolve(temppath, Blast.Bound.String.slug(segment.id));

					// Open the temp file as a buffer
					fs.readFile(tempFilePath, function gotTempFileBuffer(err, buffer) {

						if (!err) {
							cachehit = true;
							body = buffer.toString('binary');
						}

						next();
					});
				});
			}, function getSegment(next) {

				// If we already got the body, go to the deyencing fase
				if (body) {
					return next();
				}

				var job = that.server.getBodyWeight(that.data.groups, segment.id, weight, function gotSegment(err, response) {
					body = response;

					if (err) {
						return next(err);
					}

					// If we can write the article to someplace
					if (tempFilePath) {
						fs.createWriteStream(tempFilePath).write(response, 'binary');
					}

					next();
				});

				that.jobs.push(job);
			}, function deYenc(err) {

				if (err) {
					return stream.emit('error', err);
				}

				that.yenqueue.add(function deYencThrottled(nextDeyenc) {

					if (that.data.yenc) {
						// Start decoding the segment
						yfile = new Yencer.YencFile(segment);

						if (err) {
							yfile.intact = false;

							// Create a buffer, use the expected article size
							yfile.buffer = new Buffer(yfile.articlesize);

							// Indicate this file contained corrupted segments
							that.corrupted = true;

							// Indicate that there is a corrupted segment
							corrupted++;
						} else {
							yfile.decodePiece(body);

							if (!yfile.intact) {

								// Indicate this file contained corrupted segments
								that.corrupted = true;

								corrupted++;
							}
						}

						fbuffer = yfile.buffer;
					} else {
						yfile = null;
						fbuffer = new Buffer(body);
					}

					// Indicate this segment has downloaded,
					// but only do this on the first download.
					// (#stream can be called multiple times)
					if (!segment.downloaded) {
						segment.downloaded = true;
						that.finishedSegments++;

						// Emit progress event
						that.emit('progress', that.progress, segment.id, cachehit);
					}

					// Emit an event to indicate this segment is done
					informer.emit('ready-' + index);

					nextSegment(null, yfile);
					nextDeyenc();
				}, null, {weight: weight});
			});
		}, null, {weight: weight});

		// Queue the task that pushed the decoded buffers to the stream in order
		orderTasks.push(function pusher(nextPush) {
			informer.after('ready-' + index, function segmentIsReady() {

				// The first corrupted piece emits the corrupted event
				if (corrupted == 1) {
					stream.emit('corrupted');
				}

				// Every corrupted piece emits itself
				if (!yfile.intact) {
					stream.emit('corrupted-piece', yfile);
				}

				// Only emit pieces when nothing has been corrupted
				if (corrupted == 0 || ignoreCorruption) {

					// Increase the written index
					written += fbuffer.length;

					// Write the buffer to the stream
					stream.write(fbuffer);
				}

				nextPush();
			});
		});
	});

	// Queue the stream writes first (synchronously)
	Fn.series(false, orderTasks, function done(err) {

		if (err) {
			stream.emit('error', err);
		}

		if (that.parchive || ignoreCorruption) {
			stream.end();
		} else if (corrupted) {
			that.nzb.readyForPar(that);

			// Wait for the repaired signal to continue the stream
			that.after('repaired', function repaired() {

				that.debug('Piping repaired file', that.name, 'starting at', written);

				// Pipe the repaired file to the stream
				fs.createReadStream(that.repaired, {start: written}).pipe(stream);
			});
		} else {
			stream.end();
		}

		that.downloaded = true;
		stream.emit('downloadEnd');
	});

	return stream;
});

module.exports = NzbFile;