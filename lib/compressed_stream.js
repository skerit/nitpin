var Blast = __Protoblast,
    Transform = require('stream').Transform,
    Response = require('./response'),
    zlib = require('zlib'),
    CompressedStream;

/**
 * The CompressedStream Class
 *
 * @author   Jelle De Loecker   <jelle@kipdola.be>
 * @since    0.1.0
 * @version  0.1.0
 */
CompressedStream = Blast.Bound.Function.inherits(function CompressedStream() {

	// The received chunks
	this.chunks = [];

	// Have we received a first message?
	this.first = undefined;

	// Call parent constructor
	Transform.call(this);

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
CompressedStream.setMethod(function _transform(chunk, encoding, done) {

	var that = this,
	    chunks = this.chunks,
	    buffer,
	    err;

	chunks.push(encoding === 'buffer' ? chunk : new Buffer(chunk, 'binary'));

	if (this.first === undefined && (buffer = Buffer.concat(chunks).toString('binary')).indexOf('\r\n') !== -1) {
		this.first = buffer.substring(0, buffer.indexOf('\r\n') + 2);

		// Clear all the entries in chunks
		chunks.length = 0;

		// Add a new buffer entry
		chunks[0] = new Buffer(buffer.substring(buffer.indexOf('\r\n') + 2), 'binary');

		this.push(this.first);
	}

	zlib.inflate(Buffer.concat(chunks), function inflated(error, result) {

		if (result !== undefined && result.toString().substr(-3) === '.\r\n') {
			that.push(result);
			that.push(null);
		}

		done();
	});
});

module.exports = CompressedStream;