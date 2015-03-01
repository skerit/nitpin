var Blast = __Protoblast,
    Transform = require('stream').Transform,
    Response = require('./response'),
    ResponseStream;

/**
 * The ResponseStream Class
 *
 * @author   Jelle De Loecker   <jelle@kipdola.be>
 * @since    0.1.0
 * @version  0.1.0
 *
 * @param    {Boolean}    multiline
 */
ResponseStream = Blast.Bound.Function.inherits(function ResponseStream(multiline) {

	// Is this a multiline response?
	this.multiline = !!multiline;

	// What is the response so far?
	this.response = undefined;

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
 * @param    {Function}        callback
 */
ResponseStream.setMethod(function _transform(chunk, encoding, callback) {

	var response = this.response,
	    err;

	if (response === undefined) {
		this.response = response = Response.createFromString(encoding === 'buffer' ? chunk.toString('binary') : chunk);

		if (response.status > 399) {
			err = new Error(response.message);
			err.code = response.status;
			return callback(err);
		}

		if (this.multiline === false) {
			this.push(response);
			this.end();
		}
	} else {
		response.lines.push(chunk);
	}

	callback();
});

/**
 * The _flush method
 *
 * @author   Robin van der Vleuten <robinvdvleuten@gmail.com>
 * @author   Jelle De Loecker   <jelle@kipdola.be>
 * @since    0.1.0
 * @version  0.1.0
 *
 * @param    {Function}    callback
 */
ResponseStream.setMethod(function _flush(callback) {
	this.push(this.response);
	callback();
});

module.exports = ResponseStream;