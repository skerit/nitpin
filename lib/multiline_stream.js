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

	// The response object
	this.response = null;

	// The previous buffer chunk
	this.prevbuf = null;

	// Buffer data that should wait for next push
	this.waitbuf = null;

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

	var buffer,
	    lines,
	    bend,
	    len,
	    err;

	// If there is a buffer waiting, prepend it to this chunk
	if (this.waitbuf) {
		chunk = Buffer.concat([this.waitbuf, chunk]);
		this.waitbuf = null;
	}

	if (this.response == null) {
		this.response = Response.createFromChunk(chunk, encoding);

		if (this.response.status > 399) {
			err = new Error(this.response.message);
			err.code = this.response.status;
			return done(err);
		}
	}

	if (chunk.length > 4 || !this.prevbuf) {
		bend = chunk;
	} else {
		bend = Buffer.concat([this.prevbuf, chunk]);
	}

	len = bend.length;

	// Look for ".\r\n", indicating the end of the stream
	if ((len == 3 || bend[len-5] == 13 && bend[len-4] == 10)
	    && bend[len-3] == 46 && bend[len-2] == 13 && bend[len-1] == 10) {

		if (chunk.length > 3) {
			// Remove the ".\r\n" from the end of the message
			chunk = chunk.slice(0, -3);

			this.push(chunk);
		}

		// End the stream
		this.push(null);
	} else {

		// If the last bit is a dot, wait for the next buffer
		if (chunk[chunk.length-1] == 46) {
			this.waitbuf = chunk.slice(-1);
			chunk = chunk.slice(0, -1);
		}

		this.push(chunk);
	}

	// Set this new buffer as the previous buffer
	this.prevbuf = chunk;

	return done();
});

module.exports = MultilineStream;