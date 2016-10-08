# argon2themax
An easy to use Node.JS library with one goal:
Increase password security by hashing passwords with the most costly Argon2 
hash possible.

[Argon2](https://github.com/P-H-C/phc-winner-argon2) is designed to
hash in parallel on high CPU count x86 systems utilizing 4GB of memory
in order to make the resulting hashes exceedingly difficult to crack
with GPUs or ASIC processors.

It allows you to adjust parallelism, apply a time cost, as well as a
memory cost. But, deciding how to set those parameters can be annoying.
The defaults are known to be very secure today. However, with this
library you can fully take advantage of whatever hardware you are hashing
on. Why would you use the defaults when you can apply 10x or 100x the
work to your hash and maintain a good user experience?

## Why?
How do you decide on the trade off of security vs user experience?
I'm guessing you don't think about this much and probably do whatever
your password hashing library does by default.

We (software engineers) should all be hashing passwords with the highest
levels of security possible while still maintaining a great user
experience. We owe it to our users.

Do you run massively parallel, high memory systems dedicated to hashing
passwords? No? Attackers that crack passwords sure do. You might as well
protect your passwords as well as you can.

## Installation
Argon2TheMax depends on the [argon2](https://github.com/ranisalt/node-argon2) Node module, which
requires node-gyp to be installed globally. It also requires a modern
C++ compiler. Please see the [argon2 ReadMe](https://github.com/ranisalt/node-argon2)
for more information if you have trouble running `npm install`.

We require Node.JS v4.0.0+.

```sh
npm install -g node-gyp

npm install --save argon2themax
```

## Typical Usage
You should use Argon2TheMax at startup time of your service that is hashing
passwords. It should also be ran when your system is otherwise idle. It is
very CPU and memory intensive and may temporarily use up to 4GB RAM if it 
is available.

In its simplest usage you just speciy the max time (in milliseconds)
that you want to spend hashing things. It will take a while, trying various 
Argon2 options and spit back an option class that takes as close to your
specified max time, without going over. This allows you to decide how much 
time you want to devote to hashing and verifying passwords. Choose the biggest
number that won't upset your users. 250ms is reasonable, but up to one
second might even be tolerable in high security scenarios.

```ts
// TypeScript / ES7
import * as argon2 from "argon2themax";
const plain = "password";

// Grab the options we want to use.
// These default options will take close to, but not more than, 250ms to compute a hash.
// The first run of getMaxOptions() takes a while (~15s on my laptop) so you should 
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

// Verifying the hash against your users' password is simple.
const match = await argon2.verify(plain, hash);
console.log(match);
```

```js
// JavaScript / ES5 / ES6
var argon2 = require("argon2themax");

// Grab the options we want to use.
// These options will take close to, but not more than, 250ms to compute a hash.
// The first run of getMaxOptions() takes a while (~15s on my laptop) so you should 
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

        // Verifying the hash is simple.
        return argon2.verify(plain, hash);

    }).then(function(match) {
        
        // Does this password match the hash?
        return match;
    });
```

## Using Instead of Argon2 Module
For ease of use Argon2TheMax includes a proxy to the [argon2](https://github.com/ranisalt/node-argon2)
module since we use it internally. If you already use the excellent Argon2 module
you can remove your dependency on that module and just use Argon2TheMax.

Simply change your imports and everything should be good to go:

```js
// Change this:
var argon2 = require("argon2");

// To this:
var argon2 = require("argon2themax");
```

## Advanced Usage
You may not want to recompute the most expensive hash on every server startup.
If you have a roughly homogenous server farm, or only one server, you should run
the getMaxOptions and persist the resulting JSON for future usages in your 
production environment, maybe with a config module or something of the sort.

You can also retrieve the entire list of timings that were recorded as well as 
implement custom timing and selector strategies to choose a timing, and adjust 
the salt and plain password used for testing. There aren't examples for that yet,
though the interfaces are exposed.

## Future
Let me know over on the (issues)[https://github.com/jdconley/argon2themax/issues] if you have any issues!