"use strict";

/// <reference types="node" />

import * as os from "os";
import * as _ from "lodash";

// Begin Argon2 cloned interface for ease of use
export const argon2d: number = 0;
export const argon2i: number = 1;
export const argon2id: number = 2;

export interface Options {
    hashLength?: number;
    timeCost?: number;
    memoryCost?: number;
    parallelism?: number;
    type?: number; // argon2d, argon2i, or argon2id
    raw?: boolean;
}

export interface NumericLimit {
    max: number;
    min: number;
}

export interface OptionLimits {
    hashLength: NumericLimit;
    memoryCost: NumericLimit;
    timeCost: NumericLimit;
    parallelism: NumericLimit;
}

const argon2lib: any = require("argon2");
export const defaults: Options = argon2lib.defaults;
export const limits: OptionLimits = argon2lib.limits;

export const hash:
    (plain: Buffer | string, salt: Buffer, options?: Options) => Promise<string>
    = argon2lib.hash;

// This used to be defined in argon2lib.generateSalt but then being remove
// https://github.com/ranisalt/node-argon2/commit/72fed64dc752a97613a0a63143b810b35ee69abf#diff-04c6e90faac2675aa89e2176d2eec7d8L24
export function generateSalt(length?: number): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        crypto.randomBytes(length || 16, (err, salt) => {
            if (err) {
                reject(err);
            }
            resolve(salt);
        })
    })
};

export const verify:
    (hash: string, plain: Buffer | string) => Promise<boolean>
    = argon2lib.verify;


// End Argon2 cloned interface for ease of use

export namespace Measurement {
    export interface Timing {
        options: Options;
        computeTimeMs: number;
        hashCost: number;
    }

    export interface TimingResult {
        timings: Timing[];
    }

    export interface TimingOptions {
        maxTimeMs?: number;
        type?: number;
        saltLength?: number;
        plain?: string;
        statusCallback?: (timing: Timing) => boolean;
    }

    export interface TimingStrategy {
        run(options: TimingOptions): Promise<TimingResult>;
        name: string;
    }

    export interface TimingContext {
        strategy: TimingStrategy;
        accumulatedTimeMs: number;
        timingOptions: TimingOptions;
        startingOptions: Options;
        data: any;
        pendingResult: TimingResult;
    }

    export abstract class TimingStrategyBase implements TimingStrategy {
        name: string;

        async run(options: TimingOptions): Promise<TimingResult> {
            let opts = _.clone(defaults);
            opts.type = options.type;

            const context: TimingContext = {
                accumulatedTimeMs: 0,
                data: {},
                startingOptions: opts,
                strategy: this,
                timingOptions: options,
                pendingResult: {
                    timings: []
                }
            };

            this.onBeforeStart(context);

            // We'll mutate these options, so we clone them to not affect the startingOptions
            opts = _.clone(opts);

            const salt = await this.generateSalt(context);

            // Warm up so testing is a tad more accurate
            for (let i = 0; i < 3; i++) {
                await hash(options.plain, salt, opts);
            }

            let lastTiming: Timing;

            do {
                const startHrtime = process.hrtime();
                await hash(options.plain, salt, opts);
                const elapsedHrtime = process.hrtime(startHrtime);

                const msElapsed = elapsedHrtime[0] * 1e3 + elapsedHrtime[1] / 1e6;
                context.accumulatedTimeMs += msElapsed;

                lastTiming = {
                    computeTimeMs: msElapsed,
                    options: _.clone(opts),
                    hashCost: opts.memoryCost * opts.parallelism * opts.timeCost
                };

                context.pendingResult.timings.push(lastTiming);

                // Allow the callback to cancel the process if it feels the urge
                if (options.statusCallback && !options.statusCallback(lastTiming)) {
                    break;
                }

                // Allow the implementation to stop the test run when updating options
                if (!this.applyNextOptions(context, lastTiming, opts)) {
                    break;
                }

            } while (!this.isDone(context, lastTiming));

            return context.pendingResult;
        }

        abstract onBeforeStart(context: TimingContext): void;
        abstract applyNextOptions(context: TimingContext, lastTiming: Timing, options: Options): boolean;

        isDone(context: TimingContext, lastTiming: Timing): boolean {
            return lastTiming.computeTimeMs >= context.timingOptions.maxTimeMs;
        }

        generateSalt(context: TimingContext): Promise<Buffer> {
            return generateSalt(context.timingOptions.saltLength);
        }
    }

    export class MaxMemoryMarchStrategy extends TimingStrategyBase {
        name: string = "maxmemory";

        onBeforeStart(context: TimingContext): void {
            context.startingOptions.parallelism =
                context.data.parallelism = Math.max(
                    Math.min(os.cpus().length * 2, limits.parallelism.max),
                    limits.parallelism.min);
            context.data.memoryCostMax = Math.min(
                Math.floor(Math.log2(os.totalmem() / 1024)),
                limits.memoryCost.max);
        }

        applyNextOptions(context: TimingContext, lastTiming: Timing, options: Options): boolean {
            // Prefer adding more memory, then add more time
            if (options.memoryCost < context.data.memoryCostMax) {
                options.memoryCost++;
            } else if (options.timeCost < limits.timeCost.max) {
                options.memoryCost = defaults.memoryCost;
                options.timeCost++;
            } else {
                // Hit both the memory and time limits -- Is this a supercomputer?
                return false;
            }

            return true;
        }
    }

    export class ClosestMatchStrategy extends TimingStrategyBase {
        name: string = "closestmatch";

        onBeforeStart(context: TimingContext): void {
            context.startingOptions.parallelism =
                context.data.parallelism = Math.max(
                    Math.min(os.cpus().length * 2, limits.parallelism.max),
                    limits.parallelism.min);
            context.data.memoryCostMax = Math.min(
                Math.floor(Math.log2(os.totalmem() / 1024)),
                limits.memoryCost.max);
            context.data.isDone = false;
            context.data.lastOvershot = false;
        }

        applyNextOptions(context: TimingContext, lastTiming: Timing, options: Options): boolean {
            // Find every timeCost at a every memory cost that satisfies the timing threshold
            // Add more time until the timing threshold is reached.
            // Then go back to default timeCost and add memory.
            // Repeat until the first attempt at a given memory cost fails or we reached the max memory.

            if (lastTiming.computeTimeMs >= context.timingOptions.maxTimeMs) {
                // Two in a row means we are done.
                if (context.data.lastOvershot) {
                    return !(context.data.isDone = true);
                }

                // Increase memory and reduce timeCost to default to try next memory option.
                if (options.memoryCost < limits.memoryCost.max) {
                    options.timeCost = context.startingOptions.timeCost;
                    options.memoryCost++;
                    context.data.lastOvershot = true;
                } else {
                    return !(context.data.isDone = true);
                }
            } else {
                context.data.lastOvershot = false;

                if (options.timeCost < limits.timeCost.max) {
                    options.timeCost++;
                } else { // Wow, really shouldn't hit max timeCost ever.
                    return !(context.data.isDone = true);
                }
            }

            return true;
        }

        isDone(context: TimingContext, lastTiming: Timing): boolean {
            return !!context.data.isDone;
        }
    }

    export enum TimingStrategyType {
        MaxMemoryMarch,
        ClosestMatch
    }

    export function getTimingStrategy(type: TimingStrategyType): TimingStrategy {
        switch (type) {
            case TimingStrategyType.ClosestMatch:
                return new ClosestMatchStrategy();
            case TimingStrategyType.MaxMemoryMarch:
                return new MaxMemoryMarchStrategy();
            default:
                throw new Error("Unknown type.");
        }
    }

    export const defaultTimingStrategy: Measurement.TimingStrategy = new Measurement.ClosestMatchStrategy();
    export const defaultTimingOptions: Measurement.TimingOptions = {
            type: argon2i,
            maxTimeMs: 100,
            plain: "this is a super cool password",
            saltLength: 16,
            statusCallback: t => {
                const ms = `Hashed in ${t.computeTimeMs}ms.`;
                const hc = `Cost: ${t.hashCost}.`;
                const pc = `P: ${t.options.parallelism}.`;
                const mc = `M: ${t.options.memoryCost} (${Math.pow(2, t.options.memoryCost) / 1024}MB).`;
                const tc = `T: ${t.options.timeCost}.`;

                console.log(`${ms} ${hc} ${pc} ${mc} ${tc}`);

                return true;
            }
        };

    export function generateTimings(
        options?: Measurement.TimingOptions,
        timingStrategy?: Measurement.TimingStrategy): Promise<Measurement.TimingResult> {

        timingStrategy = timingStrategy || defaultTimingStrategy;
        options = _.extend({}, defaultTimingOptions, options);

        return timingStrategy.run(options);
    }
}

export namespace Selection {
    import Timing = Measurement.Timing;
    import TimingResult = Measurement.TimingResult;

    export interface SelectionStrategy {
        initialize(timingResults: TimingResult): void;
        select(maxTimeMs: number): Timing;
        fastest(): Timing;
        slowest(): Timing;
        name: string;
    }

    export abstract class LinearSelectionStrategy implements SelectionStrategy {
        name: string;

        private sortedTimings: Timing[];
        private timingsCache: { [ms: number]: Timing; } = { };
        private fastestTiming: Timing;
        private slowestTiming: Timing;

        abstract getSortedTimings(timings: Timing[]): Timing[];

        initialize(timingResults: TimingResult): void {
            if (!timingResults || !timingResults.timings ||
                !timingResults.timings.length) {
                    throw new Error("Argument error. No timings found.");
                }

            // Sort timings by memory and then elapsed ms
            // So the most memory expensive things will be first for selection
            this.sortedTimings = this.getSortedTimings(timingResults.timings);

            const computeTimeList = _.sortBy(timingResults.timings, "computeTimeMs");
            this.fastestTiming = _.head(computeTimeList);
            this.slowestTiming = _.last(computeTimeList);
        }

        select(maxTimeMs: number): Timing {
            const timing = this.timingsCache[maxTimeMs] ||
                _.findLast(this.sortedTimings, timing => {
                    return timing.computeTimeMs <= maxTimeMs;
                });

            // No options available...
            if (!timing) {
                return this.fastest();
            }

            this.timingsCache[maxTimeMs] = timing;

            return timing;
        }

        fastest(): Timing {
            return this.fastestTiming;
        }

        slowest(): Timing {
            return this.slowestTiming;
        }
    }

    export class MaxCostSelectionStrategy extends LinearSelectionStrategy {
        name: string = "maxcost";

        getSortedTimings(timings: Timing[]): Timing[] {
            return _.orderBy(timings,
                ["hashCost", "computeTimeMs"],
                ["asc", "asc"]);
        }
    }

    export class ClosestMatchSelectionStrategy extends LinearSelectionStrategy {
        name: string = "closestmatch";

        getSortedTimings(timings: Timing[]): Timing[] {
            return _.sortBy(timings, "computeTimeMs");
        }
    }

    export enum SelectionStrategyType {
        MaxCost,
        ClosestMatch
    }

    export function getSelectionStrategy(type: SelectionStrategyType): SelectionStrategy {
        switch (type) {
            case SelectionStrategyType.ClosestMatch:
                return new ClosestMatchSelectionStrategy();
            case SelectionStrategyType.MaxCost:
                return new MaxCostSelectionStrategy();
            default:
                throw new Error("Unknown type.");
        }
    }
}

import TimingStrategyType = Measurement.TimingStrategyType;
import TimingStrategy = Measurement.TimingStrategy;
import SelectionStrategyType = Selection.SelectionStrategyType;
import SelectionStrategy = Selection.SelectionStrategy;

const optionsCache: { [key: string]: Options; } = { };
function optionsCacheKey(maxMs: number = Measurement.defaultTimingOptions.maxTimeMs,
        timingStrategy: string,
        selectionStrategy: string): string {
            return `${maxMs}:${timingStrategy}:${selectionStrategy}`;
}

export async function getMaxOptionsWithStrategies(
        maxMs: number = Measurement.defaultTimingOptions.maxTimeMs,
        timingStrategy: Measurement.TimingStrategy,
        selectionStrategy: SelectionStrategy
    ): Promise<Options> {

    const cacheKey = optionsCacheKey(maxMs, timingStrategy.name, selectionStrategy.name);
    let options = optionsCache[cacheKey];
    if (options) {
        return options;
    }

    const timings = await Measurement.generateTimings({ maxTimeMs: maxMs }, timingStrategy);
    selectionStrategy.initialize(timings);

    const selectedTiming = selectionStrategy.select(maxMs);
    optionsCache[cacheKey] = options = selectedTiming.options;

    return options;
}

export async function getMaxOptions(
        maxMs: number = Measurement.defaultTimingOptions.maxTimeMs,
        timingStrategy: TimingStrategyType = TimingStrategyType.ClosestMatch,
        selectionStrategy: SelectionStrategyType = SelectionStrategyType.MaxCost
    ): Promise<Options> {

    return getMaxOptionsWithStrategies(
        maxMs,
        Measurement.getTimingStrategy(timingStrategy),
        Selection.getSelectionStrategy(selectionStrategy)
    );
}
