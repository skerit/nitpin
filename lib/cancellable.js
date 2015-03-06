var Blast = __Protoblast,
    Fn = Blast.Bound.Function,
    Cancellable;

/**
 * The Cancellable class
 *
 * @author   Jelle De Loecker   <jelle@kipdola.be>
 * @since    0.1.3
 * @version  0.1.3
 */
Cancellable = Fn.inherits('Informer', function Cancellable(job) {

	// Set the function to execute if not cancelled
	this.job = job;

	// Has the function already executed?
	this.executed = false;

	// Has it already been cancelled?
	this.cancelled = false;

	// Have we been paused
	this.paused = false;
});

/**
 * Cancel the job if possible
 *
 * @author   Jelle De Loecker   <jelle@kipdola.be>
 * @since    0.1.3
 * @version  0.1.3
 */
Cancellable.setMethod(function cancel() {

	// Don't cancel it twice
	if (this.cancelled) {
		return this.emit('alreadycancelled');
	}

	// Don't cancel if it has already executed
	if (this.executed) {
		return this.emit('alreadyexecuted');
	}

	this.cancelled = true;
	this.emit('cancel');
});

/**
 * Pause the job if possible
 *
 * @author   Jelle De Loecker   <jelle@kipdola.be>
 * @since    0.1.3
 * @version  0.1.3
 */
Cancellable.setMethod(function pause() {

	// Do nothing if already paused, cancelled or executed
	if (this.paused || this.cancelled || this.executed) {
		return;
	}

	this.paused = true;
	this.emit('paused');
});

/**
 * Resume the job if possible
 *
 * @author   Jelle De Loecker   <jelle@kipdola.be>
 * @since    0.1.3
 * @version  0.1.3
 */
Cancellable.setMethod(function resume() {

	// Do nothing if it hasn't been paused or already cancelled or executed
	if (!this.paused || this.cancelled || this.executed) {
		return;
	}

	this.paused = false;
	this.emit('resumed');
});

/**
 * Execute the job if possible
 *
 * @author   Jelle De Loecker   <jelle@kipdola.be>
 * @since    0.1.3
 * @version  0.1.3
 *
 * @param    {Function}   fnc   Optional function to execute if not yet given
 */
Cancellable.setMethod(function execute(fnc) {

	var that = this;

	if (this.cancelled) {
		return this.emit('executionprevented');
	}

	if (this.paused) {

		this.once('resumed', function whenResumed() {
			that.execute(fnc);
		});

		return this.emit('executiondelayed');
	}

	if (this.job) this.job();
	if (fnc) fnc();

	this.emit('executed');
});

module.exports = Cancellable;