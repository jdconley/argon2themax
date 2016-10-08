"use strict";

import * as argon2 from "argon2";
import * as os from "os";
import * as _ from "lodash";

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
    timingOptions: TimingOptions;
    startingOptions: argon2.Options;
    data: any;
}

export abstract class TimingStrategyBase implements TimingStrategy {
    async run(options: TimingOptions): Promise<TimingResult> {
        const opts = _.clone(argon2.defaults);
        opts.argon2d = options.argon2d;

        const context: TimingContext = {
            data: {},
            startingOptions: opts,
            strategy: this,
            timingOptions: options
        };

        this.onBeforeStart(context);

        const salt = await this.generateSalt(context);

        const result: TimingResult = {
            timings: []
        };

        let lastTiming: Timing;

        do {
            const startHrtime = process.hrtime();
            await argon2.hash(options.plain, salt, opts);
            const elapsedHrtime = process.hrtime(startHrtime);

            lastTiming = {
                computeTimeMs: elapsedHrtime[0] * 1e3 + elapsedHrtime[1] / 1e6,
                options: _.clone(opts)
            };

            result.timings.push(lastTiming);

            // Allow the callback to cancel the process if it feels the urge
            if (options.statusCallback && !options.statusCallback(lastTiming)) {
                break;
            }

            // Allow the implementation to stop the test run when updating options
            if (!this.applyNextOptions(context, opts)) {
                break;
            }

        } while (!this.isDone(context, lastTiming));

        return result;
    }

    abstract onBeforeStart(context: TimingContext): void;
    abstract applyNextOptions(context: TimingContext, options: argon2.Options): boolean;

    isDone(context: TimingContext, lastTiming: Timing): boolean {
        return lastTiming.computeTimeMs >= context.timingOptions.maxTimeMs;
    }

    generateSalt(context: TimingContext): Promise<Buffer> {
        return argon2.generateSalt(context.timingOptions.saltLength);
    }
}

class MaxMemoryMarchStrategy extends TimingStrategyBase {
    onBeforeStart(context: TimingContext): void {
        context.startingOptions.parallelism =
            context.data.parallelism = Math.max(
                Math.min(os.cpus().length * 2, argon2.limits.parallelism.max),
                argon2.limits.parallelism.min);

        context.data.memoryCostMax = Math.min(
            Math.floor(Math.log2(os.freemem() / 1024)),
            argon2.limits.memoryCost.max);
    }

    applyNextOptions(context: TimingContext, options: argon2.Options): boolean {
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
            _.find(this.sortedTimings, timing => {
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

export class MaxMemorySelectionStrategy extends LinearSelectionStrategy {
    getSortedTimings(timings: Timing[]): Timing[] {
        return _.orderBy(timings,
            ["options.memoryCost", "computeTimeMs"],
            ["desc", "desc"]);
    }
}

export class ClosestMatchSelectionStrategy extends LinearSelectionStrategy {
    getSortedTimings(timings: Timing[]): Timing[] {
        return _.sortBy(timings, "computeTimeMs");
    }
}

export enum SelectionStrategyType {
    MaxMemory,
    ClosestMatch
}

export class Argon2TheMax {
    public static defaultTimingStrategy: TimingStrategy = new MaxMemoryMarchStrategy();
    public static defaultTimingOptions: TimingOptions = {
        argon2d: false,
        maxTimeMs: 1000,
        plain: "this is a super cool password",
        saltLength: 16,
        statusCallback: Argon2TheMax.logStatus
    };

    private static logStatus(timing: Timing): boolean {
        console.log(`Took ${timing.computeTimeMs}ms.
            Parallelism: ${timing.options.parallelism}.
            MemoryCost: ${timing.options.memoryCost} (${Math.pow(2, timing.options.memoryCost) / 1024}MB).
            TimeCost: ${timing.options.timeCost}.`);

        return true;
    }

    static getSelectionStrategy(type: SelectionStrategyType): SelectionStrategy {
        switch (type) {
            case SelectionStrategyType.ClosestMatch:
                return new ClosestMatchSelectionStrategy();
            case SelectionStrategyType.MaxMemory:
                return new MaxMemorySelectionStrategy();
            default:
                throw new Error("Unknown type.");
        }
    }

    static generateTimings(options?: TimingOptions, timingStrategy?: TimingStrategy): Promise<TimingResult> {
        timingStrategy = timingStrategy || Argon2TheMax.defaultTimingStrategy;
        options = _.extend({}, Argon2TheMax.defaultTimingOptions, options);

        return timingStrategy.run(options);
    }

    static async getMaxOptions(
            maxMs: number,
            selectionStrategy: SelectionStrategyType = SelectionStrategyType.ClosestMatch
        ): Promise<argon2.Options> {

        const timings = await Argon2TheMax.generateTimings({ maxTimeMs: maxMs });
        const strategy: SelectionStrategy = Argon2TheMax.getSelectionStrategy(selectionStrategy);
        strategy.initialize(timings);

        const selectedTiming = strategy.select(maxMs);
        return selectedTiming.options;
    }
}