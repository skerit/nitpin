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

	// The response object
	this.response = null;

	// Call parent constructor
	Transform.call(this, {objectMode: true});

}, Transform);

/**
 * The required _transform method
 *
 * @author   Robin van der Vleuten <robinvdvleuten@gmail.com>
 * @author   Jelle De Loecker   <jelle@kipdola.be>
 * @since    0.1.0
 * @version  0.1.1
 *
 * @param    {Buffer|String}   chunk
 * @param    {String}          encoding
 * @param    {Function}        done
 */
MultilineStream.setMethod(function _transform(chunk, encoding, done) {

	var chunks = this.chunks,
	    buffer,
	    lines,
	    len,
	    err;

	chunks.push(encoding === 'buffer' ? chunk : new Buffer(chunk));

	if (this.response == null) {
		this.response = Response.createFromChunk(chunk, encoding);

		if (this.response.status > 399) {
			err = new Error(this.response.message);
			err.code = this.response.status;
			return done(err);
		}
	}

	len = chunk.length;

	// Look for '.\r\n', indicating the end of the stream
	if (chunk[len-3] == 46 && chunk[len-2] == 13 && chunk[len-1] == 10) {

		// Remove the ".\r\n" from the end of the message
		chunk = chunk.slice(0, -3);
		this.push(chunk);
		this.push(null);
	} else {
		this.push(chunk);
	}

	return done();
});

module.exports = MultilineStream;