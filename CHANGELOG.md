## 0.1.4 (WIP)

* Bugfixes
* Improve handling of missing articles during NZB download
* Don't trust the subject wether the segment is yenced or not
* Use `graceful-fs` package to work around EMFILE errors
* Added more function names for debugging memory leaks
* Use SlowBuffer instead of a regular Buffer

## 0.1.3 (2015-05-16)

* Nitpin server command methods now return promise-like objects that can be
  paused, resumed or cancelled.
* Article bodies fetched during an NZB download will be cached
* A `progress` event is emitted on NzbFile instances when a segment is done
* De-yencing an nzb file is now throttled, so the process isn't maxed out
* Nzb-segments will now be processed through a FunctionQueue,
  so they'll arive in order
* Added PAR repair support

## 0.1.2 (2015-03-05)

* Added first (basic) unit tests
* Issued commands will no longer be spread randomly (but evenly) over the
  workers, but will wait for a worker to announce himself as free.
  This makes commands run in order more.
* Fixed multiline responses not being ended properly.
* Fix: Multiline chunk responses are no longer being kept in an array
* More NZB support and some info on it in the README

## 0.1.1 (2015-03-02)

* Fix: remove dot stuffing from server response
* Feature: Add option to convert \r\n to \n (off by default)
* Improve response handling with buffers
* Add NZB parse support

## 0.1.0 (2015-02-28)

* Initial release
