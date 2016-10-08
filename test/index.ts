import * as mocha from "mocha";
import * as chai from "chai";
import * as argon2 from "../src/index";

describe("Argon2TheMax", () => {
    it("can turn it to 11 hundred", async function (): Promise<any> {
        this.timeout(0);

        const result = await argon2.Measurement.generateTimings(
            { maxTimeMs: 1100 },
            argon2.Measurement.getTimingStrategy(argon2.Measurement.TimingStrategyType.MaxMemoryMarch));

        console.log(`Found ${result.timings.length} timings.`);

        const selector = argon2.Selection.getSelectionStrategy(
            argon2.Selection.SelectionStrategyType.ClosestMatch);
        selector.initialize(result);

        const selector2 = argon2.Selection.getSelectionStrategy(
            argon2.Selection.SelectionStrategyType.MaxCost);
        selector2.initialize(result);

        chai.assert.isNotNull(selector.select(11000));
        chai.assert.isNotNull(selector.select(1100));
        chai.assert.isNotNull(selector.select(500));
        chai.assert.isNotNull(selector.select(250));
        chai.assert.isNotNull(selector.select(100));
        chai.assert.isNotNull(selector.select(100));

        chai.assert.throw(() => selector.select(0), "No timings found with less than 0ms compute time.");

        const fastest = selector.fastest();
        chai.assert.isNotNull(fastest);
        console.log(`Fastest: ${JSON.stringify(fastest)}`);

        const slowest = selector.slowest();
        chai.assert.isNotNull(slowest);
        console.log(`Slowest: ${JSON.stringify(slowest)}`);

        chai.assert.notDeepEqual(fastest, slowest, "The fastest and slowest options should be different, or something is very wrong.");

        const salt = await argon2.generateSalt(32);
        let fastestHash: string, slowestHash: string;
        chai.assert.isNotNull(fastestHash = await argon2.hash("password", salt, fastest.options));
        chai.assert.isNotNull(slowestHash = await argon2.hash("password", salt, slowest.options));

        chai.assert.notEqual(fastestHash, slowestHash, "Hash results should be different");
    });

    it("has a simple interface", async function (): Promise<any> {
        this.timeout(0);

        const options = await argon2.getMaxOptions();
        chai.assert.isNotNull(options);
        console.log(options);

        const salt = await argon2.generateSalt();

        chai.assert.isNotNull(await argon2.hash("password", salt, options));
    });
});