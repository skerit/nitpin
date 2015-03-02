var Blast = __Protoblast,
    Fn = Blast.Bound.Function,
    parsexml = require('xml2js').parseString,
    Yencer = require('yencer'),
    http = require('http'),
    fs = require('fs'),
    NzbFile;

/**
 * NzbFile class
 *
 * @author   Jelle De Loecker   <jelle@kipdola.be>
 * @since    0.1.1
 * @version  0.1.1
 */
NzbFile = Fn.inherits('Informer', function NzbFile(filelink, server) {

	var that = this;

	if (filelink && typeof filelink == 'object') {
		server = filelink;
		filelink = null;
	}

	// The link to the nzb
	this.filelink = filelink;

	// Optional server link
	this.server = server;

	// The XML data
	this.xml = null;

	// Pars in this nzb
	this.pars = {
		main: false,
		others: []
	};

	// All the files in this nzb
	this.files = {};

	// All the rars in this nzb
	this.rars = {
		main: false,
		others: []
	};

	// Has a parse been queued?
	this._parsed = false;

	if (this.filelink) {
		this.getNZB(this.filelink, function result(err) {
			if (err) {
				that.emit('error', err);
			}
		});
	}
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
NzbFile.setMethod(function getNZB(path, callback) {

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
 * @version  0.1.1
 *
 * @param    {Function}   callback
 */
NzbFile.setMethod(function getTemp(callback) {

	var that = this;

	if (that.temppath) {
		return callback(null, that.temppath);
	}

	// Create a unique-ish id
	this.tempid = Date.now() + '-' + ~~(Math.random()*10e5);
	this.temppath = '/tmp/' + this.tempid;

	fs.mkdir(this.temppath, function(err) {
		return callback(err, that.temppath);
	});
});


/**
 * Get an NZB file
 *
 * @author   Jelle De Loecker   <jelle@kipdola.be>
 * @since    0.1.1
 * @version  0.1.1
 *
 * @param    {String}   path   The path or url
 */
NzbFile.setMethod(function downloadNZB(path, callback) {

	var that = this,
	    attempts,
	    options,
	    url;

	// Make sure the callback is only called once
	callback = Blast.Bound.Function.regulate(callback);

	if (!Blast.Bound.String.startsWith(path, 'http')) {
		return fs.readFile(path, function gotFile(err, data) {

			if (err) {
				return callback(err);
			}

			that.xml = data;
			that.parse();
			callback(null, data);
		});
	}

	url = Blast.Bound.URL.parse(path);

	options = {
		host: url.host,
		port: url.port || 80,
		path: url.pathname,
		method: 'GET'
	};

	attempts = 0;

	Fn.series(function makeRequest(nextStep) {

		var err,
		    req;

		req = http.request(options, function gotResponse(res) {

			var data = '';

			if (res.statusCode > 299) {
				attempts++;

				// Attempt 10 times to fetch the file
				if (attempts < 10) {
					setTimeout(function() {
						makeRequest(nextStep);
					}, 1000*attempts);
				} else {
					return nextStep(new Error('Error fetching file:' + res.statusCode));
				}
			}

			res.setEncoding('utf8');

			res.on('data', function gotChunk(chunk) {
				data += chunk;
			});

			res.on('end', function gotEnd() {
				that.xml = data;
				that.parse();
				nextStep();
			});
		});

		req.on('error', nextStep);

		// Submit the request
		req.end();
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
 * @version  0.1.1
 */
NzbFile.setMethod(function parse() {

	var that = this,
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

			var filename,
			    segments,
			    subject,
			    pieces,
			    split,
			    data,
			    temp,
			    seg,
			    i;

			subject = entry['$'].subject;
			pieces = /\((\d+)\/(\d+)\)/.exec(subject);

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
					number: Number(seg['$'].number)
				});
			}

			data = {
				date: new Date(Number(entry['$'].date) * 1000),
				poster: entry['$'].poster,
				subject: subject,
				pieces: Number(pieces[2]),
				filename: filename,
				groups: Blast.Bound.Object.extract(entry.groups, '$..group.0'),
				yenc: subject.indexOf('yEnc') !== -1
			};

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

		// Store the files
		that.files = files;

		// Triage the files
		that.triage();

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
NzbFile.setMethod(function _eachFile(fnc, done) {

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
NzbFile.setMethod(function eachFile(fnc, done) {

	var that = this;

	this.after('triaged', function afterFetched() {
		that._eachFile(fnc, done);
	});
});

/**
 * Triage the files in this nzb
 *
 * @author   Jelle De Loecker <jelle@kipdola.be>
 * @since    0.1.1
 * @version  0.1.1
 */
NzbFile.setMethod(function triage(fnc) {

	var that = this,
	    pars = this.pars,
	    rars = this.rars;

	this._eachFile(function eachFile(file, filename) {

		if (filename.endsWith('.par2')) {

			file.parchive = true;

			if (filename.indexOf('.vol') == -1) {
				pars.main = file;
			} else {
				pars.others.push(file);
			}

			return;
		}

		if (filename.endsWith('.rar')) {
			rars.main = file;
			return;
		}

		if (/\.r\d\d$/.exec(filename)) {
			rars.others.push(file);
		}
	}, function done() {
		that.emit('triaged');
	});
});

/**
 * Download the contents of the file
 *
 * @author   Jelle De Loecker <jelle@kipdola.be>
 * @since    0.1.1
 * @version  0.1.1
 */
NzbFile.setMethod(function download(callback) {

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
 * Download a specific file from inside an nzb and callback with the buffer
 *
 * @author   Jelle De Loecker <jelle@kipdola.be>
 * @since    0.1.1
 * @version  0.1.1
 *
 * @param    {Object}   file
 */
NzbFile.setMethod(function downloadFile(file, callback) {

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
					intact = false;
					yfile.intact = false;

					// Create a buffer, use the expected article size
					yfile.buffer = new Buffer(yfile.articlesize);
					corrupted++;
				} else {
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

module.exports = NzbFile;