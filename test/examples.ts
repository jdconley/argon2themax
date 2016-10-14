import * as mocha from "mocha";
import * as chai from "chai";
import * as argon2 from "../src/index";

describe("Can do what the readme says", () => {
    it("can do the basic ts example", async function (): Promise<any> {
        this.timeout(0);

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

        chai.assert.isTrue(match, "The password doesn't match");
    });

    it("can do advanced usage", async function (): Promise<any> {
        this.timeout(0);

        const timingStrategy = argon2.Measurement.getTimingStrategy(argon2.Measurement.TimingStrategyType.ClosestMatch);
        const timingOptions = {
                maxTimeMs: 100,
                argon2d: false,
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

        chai.assert.isTrue(result.timings.length > 0, "No timings generated");

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
        chai.assert.isTrue(match, "Password didn't verify");
    });
});