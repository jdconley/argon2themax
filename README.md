# argon2themax

[![Build Status](https://travis-ci.org/jdconley/argon2themax.svg?branch=master)](https://travis-ci.org/jdconley/argon2themax) [![npm version](https://badge.fury.io/js/argon2themax.svg)](https://badge.fury.io/js/argon2themax)

An easy to use Node.JS password hashing library with one goal:
Increase password security by hashing passwords with the most costly Argon2
hash possible.

[Argon2](https://github.com/P-H-C/phc-winner-argon2) is designed to
hash in parallel on high CPU count x86 systems utilizing up to 4GB of RAM
in order to make the resulting hashes difficult to crack with GPUs or ASIC
processors.

It allows you to adjust parallelism, and apply a time cost as well as a
memory cost. But, deciding how to set those parameters can be complicated.
The defaults are known to be very secure today. However, with this
library you can fully take advantage of whatever hardware you are hashing
on. Why would you use the defaults when you can apply 10x or 100x the
cost to your hash and maintain a good user experience?

## Why

How do you decide on the trade off of security vs user experience when it
comes to deciding on the time it takes to hash your users' passwords?
I'm guessing you don't think about this much and probably do whatever
your password hashing library does by default.

We (software engineers) should all be hashing passwords with the highest
levels of security possible while still maintaining a great user
experience. We owe it to our users. And our liability insurance.

Do you run massively parallel, high memory, systems dedicated to hashing
passwords? No? Attackers that crack passwords sure do. You might as well
protect your passwords as well as you can.

Shameless plug: If you want access to very secure hashes, have a look at
the [pwhaas.com](https://www.pwhaas.com) service.

## Installation

argon2themax depends on the [argon2](https://github.com/ranisalt/node-argon2) Node module, which
requires node-gyp to be installed globally. It also requires a modern
C++ compiler. Please see the [argon2 ReadMe](https://github.com/ranisalt/node-argon2)
for more information if you have trouble running `npm install`.

We require Node.JS v4.0.0+.

```sh
npm install -g node-gyp

npm install --save argon2themax
```

## Typical Usage

You can find all of these examples in the [test](https://github.com/jdconley/argon2themax/tree/master/test) directory.

You should use argon2themax on your service instances that are responsible for hashing
passwords. To get the most accurate measurements, you should run the `getMaxOptions()`
function for the first time while your system is idle. It is very CPU and memory
intensive and may temporarily use up to 4GB RAM if it is available.

Calculating the optimal hash options will take a while, as argon2themax tries various
Argon2 options and spits back an Option object that will let you hash passwords
using close to your specified max clock time, without going over. This allows you to
decide how much time you want to devote to hashing and verifying passwords.
Choose the biggest number that won't upset your users. 100ms (the default) is reasonable,
and much more secure than the default options for Argon2 on most systems, but up to one
second might even be tolerable in high security scenarios.

```js
// TypeScript / ES7
import * as argon2 from "argon2themax";
const plain = "password";

// Grab the options we want to use.
// These default options will take close to, but not more than, 100ms to compute a hash.
// The first run of getMaxOptions() takes a while (~5s on my laptop) so you should
// call it at startup, not when the first password hash request comes in.
// Subsequent calls use a cache.
const options = await argon2.getMaxOptions();

// Each password should have a secure, unique, salt. The argon2 module provides that.
const salt = await argon2.generateSalt();

// Hashing happens in an asynchronous event using libuv so your system can
// still process other IO items in the Node.JS queue, such as web requests.
const hash = await argon2.hash(plain, salt, options);

// This hash is what you should store in your database. Treat it as an opaque string.
console.log(hash);

// Verifying the hash against your user's password is simple.
const match = await argon2.verify(hash, plain);
console.log(match);
```

```js
// JavaScript / ES5 / Promises instead of "await"
var argon2 = require("argon2themax");

// Grab the options we want to use.
// These options will take close to, but not more than, 100ms to compute a hash.
// The first run of getMaxOptions() takes a while (~5s on my laptop) so you should
// call it at startup, not when the first password hash request comes in.
// Subsequent calls use a cache.
var maxOpts;
var plain = "password";

argon2.getMaxOptions()
    .then(function(options) {
        maxOpts = options;

        // Each password should have a secure, unique, salt. The argon2 module provides that.
        return argon2.generateSalt();

    }).then(function(salt) {

        // Hashing happens in an asynchronous event using libuv so your system can
        // still process other IO items in the Node.JS queue, such as web requests.
        return argon2.hash(plain, salt, maxOpts);

    }).then(function(hash) {

        // This hash is what you should store in your database. Treat it as an opaque string.
        console.log(hash);

        // Verifying the hash against your user's password is simple.
        return argon2.verify(hash, plain);

    }).then(function(match) {

        // Does this password match the hash?
        return match;
    });
```

## Using Instead of Argon2 Module

For ease of use argon2themax includes a proxy to the excellent
[argon2](https://github.com/ranisalt/node-argon2) module. If you already use the
Argon2 module you can remove your dependency on that module and just use argon2themax.

Simply change your imports and everything should be good to go:

```js
// Change this:
var argon2 = require("argon2");

// To this:
var argon2 = require("argon2themax");
```

## Advanced Usage

You may not want to recompute the most expensive hash on every server startup.
You should run getMaxOptions and persist the resulting JSON for future usages
in your production environment, maybe with a config module or something of the
sort.

You can also retrieve the entire list of timings that were recorded as well as
implement custom timing and selector strategies to choose a timing. You can even
adjust the salt and plain password used for testing.

### Generate timings

The "Measurement" namespace has what you need to generate timings.
You can implement your own TimingStrategy, or use one of the ones we provide.
ClosestMatch, the default, is naive but effective. It sets a fixed parallelism to CPU * 2, and tries
every memory and time cost combination starting at the defaults, until it reaches
the maxTimeMs ceiling for each memory cost. Once it hits the maxTimeMs ceiling twice,
it finishes.

```js

import * as argon2 from "argon2themax";

const timingStrategy = argon2.Measurement.getTimingStrategy(argon2.Measurement.TimingStrategyType.ClosestMatch);
const timingOptions = {
        maxTimeMs: 100,
        type: argon2.argon2i,
        saltLength: 16,
        plain: "The password you want to use for timings",
        statusCallback: (t: argon2.Measurement.Timing) => {
            // This is called whenever a timing is generated
            // This is the default status callback, a console log with info
            const ms = `Hashed in ${t.computeTimeMs}ms.`;
            const hc = `Cost: ${t.hashCost}.`;
            const pc = `P: ${t.options.parallelism}.`;
            const mc = `M: ${t.options.memoryCost} (${Math.pow(2, t.options.memoryCost) / 1024}MB).`;
            const tc = `T: ${t.options.timeCost}.`;

            console.log(`${ms} ${hc} ${pc} ${mc} ${tc}`);

            // You can cancel the measurement process by returning "false" here.
            return true;
        }
    };

// This could take a really long time, depending on your timing strategy and maxTimeMs option
const result = await argon2.Measurement.generateTimings(
    timingOptions, timingStrategy);

// Continued in the next section...

```

### Select Timings

The "Selection" namespace has the interfaces and basic implementations of timing selectors.
By default we use the `MaxCostSelectionStrategy` which finds the closest matching timing
that has the highest `hashCost`. The hash cost is determined by: `memoryCost * parallelism * timeCost`.

```js

// ... Continued from the previous section

const selector = argon2.Selection.getSelectionStrategy(
    argon2.Selection.SelectionStrategyType.MaxCost);

// Using the "result" from the example above. It is a TimingResult object.
selector.initialize(result);

// This is a Timing object, which has the result of the timing.
// It also has the argon2.Options object that can be passed into the hash function.
const onehundred = selector.select(100);

// Normal hash operations can proceed with the selected options
const salt = await argon2.generateSalt(32);
const hash = await argon2.hash("password", salt, onehundred.options);
const match = await argon2.verify(hash, "password");

console.log(`Is Match?: ${match}`);

```

## Future

Let me know over on the [issues](https://github.com/jdconley/argon2themax/issues)
if you have any issues/suggestions!