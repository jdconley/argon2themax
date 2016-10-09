# argon2themax
An easy to use Node.JS password hashing library with one goal:
Increase password security by hashing passwords with the most costly Argon2 
hash possible.

[Argon2](https://github.com/P-H-C/phc-winner-argon2) is designed to
hash in parallel on high CPU count x86 systems utilizing up to 4GB of RAM
in order to make the resulting hashes exceedingly difficult to crack
with GPUs or ASIC processors.

It allows you to adjust parallelism, and apply a time cost as well as a
memory cost. But, deciding how to set those parameters can be complicated.
The defaults are known to be very secure today. However, with this
library you can fully take advantage of whatever hardware you are hashing
on. Why would you use the defaults when you can apply 10x or 100x the
cost to your hash and maintain a good user experience?

## Why?
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
You should use Argon2TheMax on your service instances that are responsible for hashing
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

```ts
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
const match = await argon2.verify(plain, hash);
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
        return argon2.verify(plain, hash);

    }).then(function(match) {
        
        // Does this password match the hash?
        return match;
    });
```

## Using Instead of Argon2 Module
For ease of use Argon2TheMax includes a proxy to the  excellent 
[argon2](https://github.com/ranisalt/node-argon2) module. If you already use 
Argon2 module you can remove your dependency on that module and just use Argon2TheMax.

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
adjust the salt and plain password used for testing. There aren't examples for 
that yet, though the interfaces are exposed.

## Future
Let me know over on the (issues)[https://github.com/jdconley/argon2themax/issues] if you have any issues!