var Blast = __Protoblast,
    Transform = require('stream').Transform,
    Response = require('./response'),
    MultilineStream;

/**
 * The MultilineStream Class
 *
 * @author   Jelle De Loecker   <jelle@kipdola.be>
 * @since    0.1.0
 * @version  0.1.0
 */
MultilineStream = Blast.Bound.Function.inherits(function MultilineStream() {

	// The received chunks
	this.chunks = [];

	// First data to receive
	this.first = null;

	// Call parent constructor
	Transform.call(this, {objectMode: true});

}, Transform);

/**
 * The required _transform method
 *
 * @author   Robin van der Vleuten <robinvdvleuten@gmail.com>
 * @author   Jelle De Loecker   <jelle@kipdola.be>
 * @since    0.1.0
 * @version  0.1.0
 *
 * @param    {Buffer|String}   chunk
 * @param    {String}          encoding
 * @param    {Function}        done
 */
MultilineStream.setMethod(function _transform(chunk, encoding, done) {

	var chunks = this.chunks,
	    buffer,
	    lines,
	    err;

	chunks.push(encoding === 'buffer' ? chunk : new Buffer(chunk));

	if (this.first == null) {
		this.first = Response.createFromString(encoding === 'buffer' ? chunk.toString() : chunk);

		if (this.first.status > 399) {
			err = new Error(this.first.message);
			err.code = this.first.status;
			return done(err);
		}
	}

	if ('.\r\n' === (buffer = Buffer.concat(chunks).toString()).substr(-3)) {
		lines = buffer.slice(0, -3).trim().split('\r\n');

		for (var i = 0; i < lines.length; i++) {
			this.push(lines[i]);
		}

		this.push(null);
	}

	done();
});

module.exports = MultilineStream;