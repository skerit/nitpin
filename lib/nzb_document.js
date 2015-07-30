var Blast = __Protoblast,
    Fn = Blast.Bound.Function,
    SlowBuffer = require('buffer').SlowBuffer,
    NzbFile = require('./nzb_file'),
    parsexml = require('xml2js').parseString,
    request = require('request'),
    libpath = require('path'),
    Yencer = require('yencer'),
    mkdirp = require('mkdirp'),
    http = require('http'),
    fs = require('graceful-fs'),
    NzbDocument;

/**
 * The NzbDocument class: a wrapper for the actual .nzb XML file
 *
 * @author   Jelle De Loecker   <jelle@kipdola.be>
 * @since    0.1.1
 * @version  0.1.3
 *
 * @param    {String}   filelink
 * @param    {Nitpin}   server
 */
NzbDocument = Fn.inherits('Informer', function NzbDocument(filelink, server) {

	var that = this;

	if (filelink && typeof filelink == 'object') {
		server = filelink;
		filelink = null;
	}

	// The link to the nzb
	this.filelink = filelink;

	// The name of this nzb
	this.name = libpath.basename(filelink, '.nzb');

	// Create a slug
	this.slug = Blast.Bound.String.slug(this.name);

	// Optional server link
	this.server = server;

	// The XML data
	this.xml = null;

	// Has parchive been asked?
	this.parmode = false;

	// Pars in this nzb
	this.pars = {
		main: false,
		others: []
	};

	// All the files in this nzb
	this.files = {};

	// All the (main) rars in this nzb
	this.rars = {
		main: false,
		others: []
	};

	// Rar basename count
	this.rar_bases = {};

	// Has a parse been queued?
	this._parsed = false;

	if (this.filelink) {
		this.getNZB(this.filelink, function result(err) {
			if (err) {
				that.emit('error', err);
			}
		});
	}

	// Has this been marked as broken?
	this.markedAsBroken = false;

	// Total amount of broken segments
	this.brokenSegmentCount = 0;

	// There is only 1 yenqueue per server instance
	this.yenqueue = server.yenqueue;

	// Function queue for getting the segments
	this.filequeue = new Blast.Classes.FunctionQueue();

	// Filequeue limit is tricky: we want to download the segments ASAP,
	// but also not overload the process and maintain a sorted download.
	this.filequeue.limit = 50;

	// Sort the queue on every check
	this.filequeue.sort = true;

	// Start the queue
	this.filequeue.start();

	// @todo: make queue parameters configurable
});

/**
 * Total download size of all the available files
 *
 * @author   Jelle De Loecker   <jelle@kipdola.be>
 * @since    0.1.4
 * @version  0.1.4
 */
NzbDocument.setProperty(function downloadsize() {

	var count = 0,
	    key;

	for (key in this.files) {
		count += this.files[key].downloadsize;
	}

	return count;
});

/**
 * Par file count
 *
 * @author   Jelle De Loecker   <jelle@kipdola.be>
 * @since    0.1.4
 * @version  0.1.4
 */
NzbDocument.setProperty(function parcount() {

	var count = 0;

	if (this.pars.main) {
		count++;
	}

	count += this.pars.others.length;

	return count;
});

/**
 * Maximum allowed of broken segments for par to be able to repair them
 *
 * @author   Jelle De Loecker   <jelle@kipdola.be>
 * @since    0.1.4
 * @version  0.1.4
 */
NzbDocument.setProperty(function fixableSegmentCount() {

	var arr,
	    count;

	if (this._fixableSegmentCount) {
		return this._fixableSegmentCount;
	}

	arr = [];

	if (this.pars.main) {
		arr.push(this.pars.main);
	}

	if (this.pars.others.length) {
		arr = arr.concat(this.pars.others);
	}

	if (arr.length == 0) {
		return 0;
	}

	count = 0;

	arr.forEach(function eachPar(par) {

		var extract,
		    nr;

		extract = /\+(\d+)\.par2/.exec(par.name);

		if (extract && extract[1]) {
			nr = Number(extract[1]);

			if (nr) {
				count += nr;
			}
		}
	});

	this.debug('Counted fixable segments:', count);
	this._fixableSegmentCount = count;

	return count;
});

/**
 * Debug method
 *
 * @author   Jelle De Loecker   <jelle@kipdola.be>
 * @since    0.1.3
 * @version  0.1.3
 */
NzbDocument.setMethod(function debug() {

	if (!this.server.debugMode) {
		return false;
	}

	return this.server.debug('__debug__', 'NZBDOCUMENT', arguments);
});

/**
 * Abort the download
 *
 * @author   Jelle De Loecker   <jelle@kipdola.be>
 * @since    0.1.5
 * @version  0.1.5
 */
NzbDocument.setMethod(function abort() {

	var key;

	for (key in this.files) {
		this.files[key].abort();
	}

	this.filequeue.destroy();
	this.yenqueue.destroy();
});

/**
 * Mark as broken
 *
 * @author   Jelle De Loecker   <jelle@kipdola.be>
 * @since    0.1.4
 * @version  0.1.4
 */
NzbDocument.setMethod(function markBroken() {

	var file,
	    key;

	// Only mark this as broken once
	if (this.markedAsBroken) {
		return;
	}

	if (this.brokenSegmentCount > this.fixableSegmentCount) {
		this.debug('Marking as broken - Not enough fixable segments for', this.name);
	} else {
		this.debug('Marking as broken', this.name);
	}

	this.markedAsBroken = true;

	// Stop the downloads
	this.abort();

	for (key in this.files) {
		file = this.files[key];

		if (file && file.abort) {
			file.abort();
		}
	}

	this.debug('All files have been aborted for NZB', this.name);

	// Emit the broken event
	this.emitOnce('broken');
});

/**
 * Get and parse an NZB file
 *
 * @author   Jelle De Loecker   <jelle@kipdola.be>
 * @since    0.1.1
 * @version  0.1.1
 *
 * @param    {String}   path   The path or url
 */
NzbDocument.setMethod(function getNZB(path, callback) {

	var that = this;

	this.downloadNZB(path, function gotFile(err, data) {

		if (err) {
			return callback(err);
		}

		that.parse();
		callback();
	});
});

/**
 * Prepare a temporary folder
 *
 * @author   Jelle De Loecker   <jelle@kipdola.be>
 * @since    0.1.1
 * @version  0.1.3
 *
 * @param    {Function}   callback
 */
NzbDocument.setMethod(function getTemp(suffix, callback) {

	var that = this,
	    path;

	if (typeof suffix == 'function') {
		callback = suffix;
		suffix = null;
	}

	if (that.temppath && suffix == null) {
		return callback(null, that.temppath);
	}

	// Create a unique-ish id
	if (!this.tempid) {
		this.tempid = Date.now() + '-' + ~~(Math.random()*10e5);
	}

	if (!this.temppath) {
		this.temppath = libpath.resolve(this.server.tempdir, this.slug);
	}

	if (suffix) {
		path = libpath.resolve(this.temppath, suffix);
	} else {
		path = this.temppath;
	}

	mkdirp(path, function(err) {
		return callback(err, path);
	});
});

/**
 * Get an NZB file
 *
 * @author   Jelle De Loecker   <jelle@kipdola.be>
 * @since    0.1.1
 * @version  0.1.4	
 *
 * @param    {String}   path   The path or url
 */
NzbDocument.setMethod(function downloadNZB(path, callback) {

	var that = this,
	    attempts,
	    options;

	// Make sure the callback is only called once
	callback = Blast.Bound.Function.regulate(callback);

	if (!Blast.Bound.String.startsWith(path, 'http')) {
		return fs.readFile(path, function gotFile(err, data) {

			if (err) {
				return callback(err);
			}

			that.xml = data.toString();
			that.parse();
			callback(null, data);
		});
	}

	attempts = 0;

	Fn.series(function makeRequest(nextStep) {

		var err,
		    req;

		that.debug('Downloading NZB file from', path);

		request({url: path, gzip: true}, function gotResponse(err, res, xml) {

			if (err || res.statusCode > 499 && attempts < 5) {
				attempts++;
				return makeRequest(nextStep);
			}

			if (err) {
				return nextStep(err);
			}

			// @todo: handle non-xml responses
			// console.log(JSON.stringify(xml) + ' -- ' + res.statusCode)

			that.xml = xml;
			that.parse();
			nextStep();
		});
	}, function done(err) {

		if (err) {
			return callback(err);
		}

		callback(null, that.xml);
	});
});

/**
 * Parse the XML
 *
 * @author   Jelle De Loecker   <jelle@kipdola.be>
 * @since    0.1.1
 * @version  0.1.4
 */
NzbDocument.setMethod(function parse() {

	var that = this,
	    base_count = 0,
	    base_name,
	    entries,
	    files;

	if (this._parsed) {
		return;
	}

	this._parsed = true;

	files = {};

	parsexml(this.xml, function parsed(err, data) {

		var i;

		if (err) {
			that.emit('error', err);
			return;
		}

		entries = data.nzb.file;

		entries.forEach(function eachFile(entry) {

			var pieceCount,
			    filename,
			    segments,
			    subject,
			    pieces,
			    split,
			    file,
			    data,
			    temp,
			    seg,
			    i;

			subject = entry['$'].subject;

			// Get the piece info (##/##)
			pieces = /\((\d*)\/(\d+)\)/.exec(subject);

			filename = Blast.Bound.String.after(subject, '"');
			filename = Blast.Bound.String.before(filename, '"').trim();

			// If no valid filename was found, skip this entry
			if (!filename) {
				return;
			}

			// Is this a split file?
			split = /\.(\d\d\d)$/.exec(filename);

			if (split) {
				split = Number(split[1]);
				filename = filename.slice(0, -4);
			}

			segments = [];

			for (i = 0; i < entry.segments[0].segment.length; i++) {
				seg = entry.segments[0].segment[i];

				segments.push({
					id: seg['_'],
					bytes: Number(seg['$'].bytes),
					number: Number(seg['$'].number),
					from_cache: false
				});
			}

			if (pieces) {
				pieceCount = Number(pieces[2]);
			} else {
				pieceCount = segments.length;
			}

			data = {
				date: new Date(Number(entry['$'].date) * 1000),
				poster: entry['$'].poster,
				subject: subject,
				pieces: pieceCount,
				filename: filename,
				groups: Blast.Bound.Object.extract(entry.groups, '$..group.0'),
				yenc: null, // yenc is null by default (unknown)
				split: split
			};

			// If yenc is in the subject, it definitely is a yenced file
			// If it's not, it still could be
			if (subject.toLowerCase().indexOf('yenc') > -1) {
				data.yenc = true;
			}

			if (split == null) {
				data.segments = segments;
				files[filename] = data;
			} else {

				if (!files[filename]) {
					data.splitsegments = [];
					files[filename] = data;
				} else {
					files[filename].pieces += data.pieces;
				}

				files[filename].splitsegments[split] = segments
			}
		});

		for (filename in files) {
			if (files[filename].splitsegments) {
				segments = [];

				for (i = 0; i < files[filename].splitsegments.length; i++) {
					segments = segments.concat(files[filename].splitsegments[i]);
				}

				files[filename].segments = segments;
			}
		}

		that.files = {};

		// Now create the NzbFile instances
		for (filename in files) {
			that.files[filename] = new NzbFile(that, files[filename]);
		}

		// Now assign the rar files
		// Only the ones with the highest base count are added
		for (filename in that.rar_bases) {
			if (that.rar_bases[filename] > base_count) {
				base_count = that.rar_bases[filename];
				base_name = filename;
			}
		}

		for (filename in that.files) {
			file = that.files[filename];

			if (!file.isRar) {
				continue;
			}

			if (file.rar_base_name != base_name) {
				continue;
			}

			that.rars.others.push(file);
		}

		// Order the other rars
		Blast.Bound.Array.sortByPath(that.rars.others, 1, 'suborder');

		// If no main rar file was found, use the first other
		if (!that.rars.main && that.rars.others.length) {
			that.rars.main = that.rars.others.shift();
		}

		// Emit the parsed event
		that.emit('parsed');
	});
});

/**
 * Go over every found file in the nzb
 *
 * @author   Jelle De Loecker <jelle@kipdola.be>
 * @since    0.1.1
 * @version  0.1.1
 *
 * @param    {Function}   fnc
 */
NzbDocument.setMethod(function _eachFile(fnc, done) {

	var filename;

	this.after('parsed', function afterFetched() {
		for (filename in this.files) {
			fnc(this.files[filename], filename);
		}

		if (done) {
			done();
		}
	});
});

/**
 * Go over every found file in the nzb, for external use
 *
 * @author   Jelle De Loecker <jelle@kipdola.be>
 * @since    0.1.1
 * @version  0.1.1
 *
 * @param    {Function}   fnc
 */
NzbDocument.setMethod(function eachFile(fnc, done) {

	var that = this;

	this.after('triaged', function afterFetched() {
		that._eachFile(fnc, done);
	});
});

/**
 * A child file is ready for paring
 *
 * @author   Jelle De Loecker <jelle@kipdola.be>
 * @since    0.1.1
 * @version  0.1.4
 *
 * @param    {NzbFile}   brokenFile
 * @param    {Object}    brokenSegment
 */
NzbDocument.setMethod(function readyForPar(brokenFile, brokenSegment) {

	var that = this,
	    gotFiles = false,
	    gotPar = false,
	    files = [],
	    fixer,
	    doPar;

	this.emitOnce('needsRepair', brokenFile);

	if (!this.markedAsBroken) {
		this.debug('File requests PAR repair:', brokenFile.name);
	}

	this.brokenSegmentCount++;

	if (this.brokenSegmentCount > this.fixableSegmentCount) {
		return this.markBroken();
	}

	// If we're already parring, do nothing
	if (this.parmode) {
		return;
	}

	// Indicate parchiving-mode has been enabled
	this.parmode = true;

	// Create a repair folder
	this.getTemp('repair', function gotPath(err, path) {

		var parfiles,
		    filetasks,
		    tasks,
		    file,
		    key;

		if (err) {
			that.debug('Error creating repair folder:', err);
			throw err;
		} else {
			that.debug('Created repair folder at', path);
		}

		parfiles = [];

		if (that.pars.main) {
			parfiles.push(that.pars.main);
		}

		if (that.pars.others && that.pars.others.length) {
			parfiles = parfiles.concat(that.pars.others);
		}

		if (!parfiles.length) {
			that.debug('No PAR files were found, unable to repair NZB', that.name);
			return that.markBroken();
		} else {
			that.debug('Fetching', parfiles.length, 'PAR files for NZB', that.name);
		}

		// Download all the parfiles
		tasks = parfiles.map(function eachPar(parfile) {

			return function getParfile(next) {

				var writestream,
				    parstream,
				    parpath;

				// Construct the path where the par file should be downloaded
				parpath = libpath.resolve(path, parfile.name);

				// Store that full path on the file object
				parfile.parpath = parpath;

				// Create the writestream
				writestream = fs.createWriteStream(parpath)

				// Create a stream to the parfile, give it high priority
				parstream = parfile.stream(99999);
				parstream.pipe(writestream);

				// Wait for the data to be written to the file
				writestream.on('finish', function() {
					that.debug('Parfile has finished writing to', parpath);
					next();
				});
			};
		});

		for (key in that.files) {
			file = that.files[key];

			if (file.parchive) {
				continue;
			}

			files.push(file);
		}

		filetasks = files.map(function eachFile(file) {

			return function getFile(next) {

				var filestream = file.stream(88888, true),
				    writestream = fs.createWriteStream(path + '/' + file.name);

				filestream.pipe(writestream);

				// Store the path to the repair directory
				file.repairdir = path;

				// Wait for the data to be written to the file
				writestream.on('finish', next);
			};
		});

		// Get all the par files
		Fn.parallel(tasks, function finishedGettingParfiles(err) {
			that.debug('All PAR files have been downloaded');
			gotPar = true;
			doPar();
		});

		// Get all the files, including the broken ones
		Fn.parallel(filetasks, function finishedGettingFiles(err) {
			that.debug('All regular files have been downloaded for PAR repairing');
			gotFiles = true;
			doPar();
		});
	});

	doPar = function doPar() {

		// Do nothing if it's already started
		if (fixer) {
			return;
		}

		// Wait for the par files
		if (!gotPar) {
			return that.debug('Still waiting for PAR files before repairing');
		}

		// Wait for all the files
		if (!gotFiles) {
			return that.debug('Still waiting on the regular files before repairing');
		}

		// Create the repair instance
		fixer = that.server.repair(that.pars.main.parpath);

		that.debug('Created PAR fixer:', that.pars.main.parpath);

		fixer.on('progress', function gotProgress(progress) {
			that.emit('par_progress', progress);
		});

		fixer.on('debug', function gotDebug(msg) {
			that.emit('debug', msg);
		});

		fixer.on('finished', function onFinish(repaired) {

			// File can't be repaired
			if (!repaired) {
				that.debug('PAR fixer FAILED:', that.pars.main.parpath);
				return that.markBroken();
			} else {
				that.debug('PAR fixed:', that.pars.main.parpath);
				that.emit('repaired');
			}

			// Tell the files they've been repaired
			files.forEach(function eachFile(file) {

				// Store the full repaired path
				file.repaired = libpath.resolve(file.repairdir, file.name);

				// Emit the repaired event, but only for corrupted files
				if (file.corrupted) {
					file.emit('repaired', file.repaired);
				}

				// Emit a likewise event, that just says a verified file is available
				file.emit('verified', file.repaired);
			});
		});
	};
});

/**
 * Download the contents of the file
 *
 * @author   Jelle De Loecker <jelle@kipdola.be>
 * @since    0.1.1
 * @version  0.1.1
 */
NzbDocument.setMethod(function download(callback) {

	var that = this,
	    tasks = [],
	    totalCorrupted = 0,
	    files = {};

	// Go over every file in this NZB
	this.eachFile(function gotFile(file, filename) {

		// Do not download parchives (yet)
		if (file.parchive) {
			return;
		}

		tasks.push(function getFile(next) {
			that.downloadFile(file, function gotFile(err, buffer, corrupted) {

				// Total corrupted segments
				totalCorrupted += corrupted;

				files[filename] = {
					corrupted: corrupted,
					buffer: buffer
				};

				next();
			});
		});
	}, function done() {
		Fn.parallel(tasks, function tasksDone(err) {

			var temppath;

			Fn.series(function getTemp(next) {

				that.getTemp(function gotTemp(err, response) {
					temppath = response;
					next();
				});
			}, function getParchives(next) {

				var partasks,
				    parfiles;

				// Don't download parchives if they're not needed
				if (!totalCorrupted) {
					return next();
				}

				partasks = [];

				if (!that.pars.main) {
					return callback(new Error('Incomplete file and no parchives found'));
				}

				parfiles = [that.pars.main].concat(that.pars.others);

				parfiles.forEach(function eachPar(entry) {
					partasks.push(function getPar(next) {

						that.downloadFile(entry, function gotPar(err, buffer, corrupted) {

							files[entry.filename] = {
								corrupted: corrupted,
								buffer: buffer
							};

							next();
						});
					});
				});

				Fn.parallel(partasks, function gotPars() {
					next();
				});
			}, function done(err) {

				var writeTasks = [],
				    filename;

				Blast.Bound.Object.each(files, function(file, filename) {
					writeTasks.push(function (nextwrite) {
						fs.writeFile(temppath + '/' + filename, files[filename].buffer, function written(err) {
							nextwrite(err);
						});
					});
				});

				Fn.parallel(writeTasks, function done(err) {
					callback(err);
				});

			});

		});
	});
});

/**
 * Abort the download
 *
 * @author   Jelle De Loecker   <jelle@kipdola.be>
 * @since    0.1.4
 * @version  0.1.4
 */
NzbDocument.setMethod(function abort() {

	var key;

	for (key in this.files) {
		this.files[key].abort();
	}

	this.emit('aborted');
});

/**
 * Download a specific file from inside an nzb and callback with the buffer
 *
 * @author   Jelle De Loecker <jelle@kipdola.be>
 * @since    0.1.1
 * @version  0.1.4
 *
 * @param    {Object}   file
 */
NzbDocument.setMethod(function downloadFile(file, callback) {

	var that = this,
	    tasks = [],
	    intact,
	    corrupted;

	// We assume the files are intact
	intact = true;

	// Amount of missing segments
	corrupted = 0;

	// Prepare the fetching of all the file segments
	file.segments.forEach(function eachSegment(segment, index) {
		tasks.push(function getSegment(nextSegment) {
			that.server.getBody(file.groups, segment.id, function gotSegment(err, body) {

				var yfile = new Yencer.YencFile(segment);

				if (err) {

					// Segment failed to download
					that.emit('missed_segment', segment, 0);

					intact = false;
					yfile.intact = false;

					// Create a buffer, use the expected article size
					yfile.buffer = new SlowBuffer(yfile.articlesize);
					corrupted++;
				} else {

					// Segment was downloaded OK
					that.emit('got_segment', segment, body.length);

					yfile.decodePiece(body);

					if (!yfile.intact) {
						intact = false;
						corrupted++;
					}
				}

				nextSegment(null, yfile);
			});
		});
	});

	// Get all the segments in parallel
	Fn.parallel(tasks, function done(err, yfiles) {

		var buffers = [],
		    buffer,
		    yfile;

		for (var i = 0; i < yfiles.length; i++) {
			yfile = yfiles[i];
			buffers.push(yfile.buffer);
		}

		buffer = Buffer.concat(buffers);
		callback(null, buffer, corrupted);
	});
});

module.exports = NzbDocument;