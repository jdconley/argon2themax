"use strict";

/// <reference types="node" />

import * as argon2 from "argon2";
import * as os from "os";
import * as _ from "lodash";

export namespace Measurement {
    export interface Timing {
        options: argon2.Options;
        computeTimeMs: number;
    }

    export interface TimingResult {
        timings: Timing[];
    }

    export interface TimingOptions {
        maxTimeMs?: number;
        argon2d?: boolean;
        saltLength?: number;
        plain?: string;
        statusCallback?: (timing: Timing) => boolean;
    }

    export interface TimingStrategy {
        run(options: TimingOptions): Promise<TimingResult>;
    }

    export interface TimingContext {
        strategy: TimingStrategy;
        accumulatedTimeMs: number;
        timingOptions: TimingOptions;
        startingOptions: argon2.Options;
        data: any;
        pendingResult: TimingResult;
    }

    export abstract class TimingStrategyBase implements TimingStrategy {
        async run(options: TimingOptions): Promise<TimingResult> {
            let opts = _.clone(argon2.defaults);
            opts.argon2d = options.argon2d;

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
                await argon2.hash(options.plain, salt, opts);
            }

            let lastTiming: Timing;

            do {
                const startHrtime = process.hrtime();
                await argon2.hash(options.plain, salt, opts);
                const elapsedHrtime = process.hrtime(startHrtime);

                const msElapsed = elapsedHrtime[0] * 1e3 + elapsedHrtime[1] / 1e6;
                context.accumulatedTimeMs += msElapsed;

                lastTiming = {
                    computeTimeMs: msElapsed,
                    options: _.clone(opts)
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
        abstract applyNextOptions(context: TimingContext, lastTiming: Timing, options: argon2.Options): boolean;

        isDone(context: TimingContext, lastTiming: Timing): boolean {
            return lastTiming.computeTimeMs >= context.timingOptions.maxTimeMs;
        }

        generateSalt(context: TimingContext): Promise<Buffer> {
            return argon2.generateSalt(context.timingOptions.saltLength);
        }
    }

    export class MaxMemoryMarchStrategy extends TimingStrategyBase {
        onBeforeStart(context: TimingContext): void {
            context.startingOptions.parallelism =
                context.data.parallelism = Math.max(
                    Math.min(os.cpus().length * 2, argon2.limits.parallelism.max),
                    argon2.limits.parallelism.min);
            context.data.memoryCostMax = Math.min(
                Math.floor(Math.log2(os.totalmem() / 1024)),
                argon2.limits.memoryCost.max);
        }

        applyNextOptions(context: TimingContext, lastTiming: Timing, options: argon2.Options): boolean {
            // Prefer adding more memory, then add more time
            if (options.memoryCost < context.data.memoryCostMax) {
                options.memoryCost++;
            } else if (options.timeCost < argon2.limits.timeCost.max) {
                options.memoryCost = argon2.defaults.memoryCost;
                options.timeCost++;
            } else {
                // Hit both the memory and time limits -- Is this a supercomputer?
                return false;
            }

            return true;
        }
    }

    export class ClosestMatchStrategy extends TimingStrategyBase {
        onBeforeStart(context: TimingContext): void {
            context.startingOptions.parallelism =
                context.data.parallelism = Math.max(
                    Math.min(os.cpus().length * 2, argon2.limits.parallelism.max),
                    argon2.limits.parallelism.min);
            context.data.memoryCostMax = Math.min(
                Math.floor(Math.log2(os.totalmem() / 1024)),
                argon2.limits.memoryCost.max);
            context.data.isDone = false;
            context.data.lastOvershot = false;
        }

        applyNextOptions(context: TimingContext, lastTiming: Timing, options: argon2.Options): boolean {
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
                if (options.memoryCost < argon2.limits.memoryCost.max) {
                    options.timeCost = context.startingOptions.timeCost;
                    options.memoryCost++;
                    context.data.lastOvershot = true;
                } else {
                    return !(context.data.isDone = true);
                }
            } else {
                context.data.lastOvershot = false;

                if (options.timeCost < argon2.limits.timeCost.max) {
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
            argon2d: false,
            maxTimeMs: 250,
            plain: "this is a super cool password",
            saltLength: 16,
            statusCallback: t => {
                console.log(`Took ${t.computeTimeMs}ms.
                    Parallelism: ${t.options.parallelism}.
                    MemoryCost: ${t.options.memoryCost} (${Math.pow(2, t.options.memoryCost) / 1024}MB).
                    TimeCost: ${t.options.timeCost}.`);

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
    }

    export abstract class LinearSelectionStrategy implements SelectionStrategy {
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
                throw new Error(`No timings found with less than ${maxTimeMs}ms compute time.`);
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
        getSortedTimings(timings: Timing[]): Timing[] {
            return _.orderBy(timings,
                ["options.memoryCost", "options.timeCost", "options.parallelism", "computeTimeMs"],
                ["asc", "asc", "asc", "asc"]);
        }
    }

    export class ClosestMatchSelectionStrategy extends LinearSelectionStrategy {
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

export async function getMaxOptions(
        maxMs: number = Measurement.defaultTimingOptions.maxTimeMs,
        timingStrategy: TimingStrategyType = TimingStrategyType.ClosestMatch,
        selectionStrategy: SelectionStrategyType = SelectionStrategyType.MaxCost
    ): Promise<argon2.Options> {

    const tStrategy: TimingStrategy = Measurement.getTimingStrategy(timingStrategy);
    const timings = await Measurement.generateTimings({ maxTimeMs: maxMs }, tStrategy);

    const sStrategy: SelectionStrategy = Selection.getSelectionStrategy(selectionStrategy);
    sStrategy.initialize(timings);

    const selectedTiming = sStrategy.select(maxMs);
    return selectedTiming.options;
}

export const defaults = argon2.defaults;
export const limits = argon2.limits;
export const hash = argon2.hash;
export const generateSalt = argon2.generateSalt;
export const verify = argon2.verify;