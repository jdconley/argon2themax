var mocha = require("mocha");
var chai = require("chai");
var argon2 = require("../src/index");

describe("Can do what the readme says in Javascript", function() {
    it("can do the basic js example", function () {
        this.timeout(0);
        
        // Grab the options we want to use.
        // These options will take close to, but not more than, 100ms to compute a hash.
        // The first run of getMaxOptions() takes a while (~5s on my laptop) so you should 
        // call it at startup, not when the first password hash request comes in.
        // Subsequent calls use a cache.
        var maxOpts;
        var plain = "password";

        return argon2.getMaxOptions()
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
                
                chai.assert.isTrue(match, "Password didn't match.");

                // Does this password match the hash?
                return match;
            });
    });
});