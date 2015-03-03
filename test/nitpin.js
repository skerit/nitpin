var assert = require('assert'),
    Nitpin = require('../index.js'),
    server,
    worker;

describe('Nitpin', function() {

	describe('new Nitpin()', function() {
		it('should create a new Nitpin object', function() {

			// Create new object with the open php.net servers
			server = new Nitpin({
				host: 'news.php.net',
				user: null,
				pass: null,
				port: 119,
				secure: false,
				connections: 1
			});

			assert.strictEqual(server.constructor.name, 'Nitpin');
		});
	});

	describe('#getSocket()', function() {
		it('should return a NitpinWorker', function() {
			worker = server.getSocket();
		});

		it('should emit a connected event', function(done) {

			// It could take a while before the server connects
			this.timeout(5000);

			worker.after('connected', function() {
				done();
			});
		});

		it('should emit an authenticated event (even without requiring login)', function(done) {
			worker.after('authenticated', function() {
				done();
			});
		});
	});

	describe('#over(group, low, high, callback)', function() {
		it('should get an overview of messages', function(done) {
			server.over('php.doc.nl', 2, 5, function gotMessages(err, messages) {

				// There should be no errors
				assert.strictEqual(err, null);

				// There should be 4 messages
				assert.strictEqual(messages.length, 4);

				// The first message should have id 2
				assert.strictEqual(messages[0].id, '2');

				// The last message should have id 5
				assert.strictEqual(messages[3].id, '5');

				done();
			});
		});

		it('should return an error if the group does not exist', function(done) {
			server.over('non.existing.group', 2, 5, function gotMessages(err, messages) {

				assert.strictEqual(err.code, 411, 'Error code should be 411');
				assert.strictEqual(messages, undefined, 'Messages should be undefined');

				done();
			});
		});
	});

	describe('#getArticle(group, articleId, callback)', function() {
		it('should return the article with headers & body', function(done) {
			server.getArticle('php.doc.nl', 'Pine.LNX.4.44.0206241454120.20549-100000@jdi.jdimedia.nl', function gotArticle(err, headers, body) {

				// Error should be null
				assert.strictEqual(err, null);

				// Headers should be set
				assert.strictEqual(headers.subject, 'test');
				assert.strictEqual(headers.date, 'Mon, 24 Jun 2002 14');

				assert.strictEqual(body.indexOf('JDI Media Solutions') > -1, true);

				done();
			});
		});
	});

});