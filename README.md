# argon2themax
An easy to use Node.JS library with one goal:
Find the most costly Argon2 option set for secure password hashing.

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
protect your users' passwords as well as you can.

## Installation
Argon2TheMax depends on the [argon2](https://github.com/ranisalt/node-argon2) Node module, which
requires node-gyp to be installed globally. It also requires a modern
C++ compiler. Please see the [argon2 ReadMe](https://github.com/ranisalt/node-argon2)
for more information if you have trouble running `npm install`.

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
// TypeScript / ES6
import { Argon2TheMax } from "argon2themax";
import * from "argon2";

// Grab the options we want to use.
// These options should take close to, but not more than, 250ms to compute a hash!
// You'll want to store them, because finding them is expensive.
const options = await Argon2TheMax.getMaxOptions(250);

// Each password should have a secure, unique, hash. The argon2 module provides that.
const salt = await argon2.generateSalt();

// Hashing happens in an asynchronous event using libuv so your system can
// still process other IO items in the Node.JS queue, such as web requests.
const hash = await argon2.hash("password", salt, options);

// This hash is what you should store in your database. Treat it as an opaque string.
console.log(hash);

// Verifying the hash against your users' password is simple.
const match = await argon2.verify("password", hash);
console.log(match);
```

```js
// JavaScript / ES5
var Argon2TheMax = require("argon2themax").Argon2TheMax;
var argon2 = require("argon2");

// Grab the options we want to use.
// These options should take close to, but not more than, 250ms to compute a hash!
// You'll want to store them, because finding them is expensive.
Argon2TheMax.getMaxOptions(250)
    .then(function(options) {

        // Each password should have a secure, unique, hash. The argon2 module provides that.
        argon2.generateSalt().then(function(salt) {

            // Hashing happens in an asynchronous event using libuv so your system can
            // still process other IO items in the Node.JS queue, such as web requests.
            argon2.hash("password", salt, options).then(function(hash) {

                // This hash is what you should store in your database. Treat it as an opaque string.
                console.log(hash);


                // Verifying the hash is simple.
                argon2.verify("password", hash).then(function(match) {
                    console.log(match);
                });
            });
        });
    });
```

## Advanced Usage
You may not want to recompute the most expensive hash on every server startup.
If you have a roughly homogenous server farm, or only one server, you should run
the getMaxOptions and persist that for future usages in your production environment,
maybe with a config module or something of the sort.

You can also retrieve the entire list of timings that were recorded as well as 
implement custom selectors to choose a timing, and adjust the salt and plain password
used for testing. There aren't examples for that yet, though the interfaces are exposed.

## Future
Let me know over on the (issues)[https://github.com/jdconley/argon2themax/issues] if you have any issues!