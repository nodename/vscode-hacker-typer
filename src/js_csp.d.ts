declare module 'js-csp' {

    namespace Boxes {
        class Box<T> {
            value: T
            constructor(value: T)
        }
        class PutBox<T> {
            handler: Handlers.HandlerType
            value: T
            constructor(handler: Handlers.HandlerType, value: T)
        }
    }

    namespace Buffers {
        class RingBuffer<T> {
            head: number
            tail: number
            length: number
            arr: Array<T>
            constructor(head: number, tail: number, length: number, arr: Array<T>)
            pop(): T
            unshift(element: T): void
            unboundedUnshift(element: T): void
            resize(): void
            cleanup(predicate: Function): void
        }
        var ring: <T>(n: number) => RingBuffer<T>

        class FixedBuffer<T> {
            buffer: RingBuffer<T>
            n: number
            constructor(buffer: RingBuffer<T>, n: number)
            isFull(): boolean
            remove(): T
            add(item: T): void
            closeBuffer(): void
            count(): number
        }
        var fixed: <T>(n: number) => FixedBuffer<T>

        class DroppingBuffer<T> {
            buffer: RingBuffer<T>
            n: number
            constructor(buffer: RingBuffer<T>, n: number)
            isFull(): boolean
            remove(): T
            add(item: T): void
            closeBuffer(): void
            count(): number
        }
        var dropping: <T>(n: number) => DroppingBuffer<T>

        class SlidingBuffer<T> {
            buffer: RingBuffer<T>
            n: number
            constructor(buffer: RingBuffer<T>, n: number)
            isFull(): boolean
            remove(): T
            add(item: T): void
            closeBuffer(): void
            count(): number
        }
        var sliding: <T>(n: number) => SlidingBuffer<T>

        class PromiseBuffer {
            value: any
            static NO_VALUE: string
            static isUndelivered: (value: any) => boolean
            constructor(value: any)
            isFull(): boolean
            remove(): any
            add(item: any): void
            closeBuffer(): void
            count(): number
        }
        var promise: (n: number) => PromiseBuffer

        type BufferType<T> = FixedBuffer<T> | DroppingBuffer<T> | SlidingBuffer<T> | PromiseBuffer;
    }

    namespace Chennals {
        const MAX_DIRTY: number
        const MAX_QUEUE_SIZE: number
        const CLOSED: null
        interface Channel {
            [index: string]: any
            closed: boolean
            close(): void
        }
        var chan: (buf?: BufferType<any>, xfrom?: Function, exHandler?: Function) => Channel
    }

    namespace Dispatch {
        var queueDispatcher: () => void
        var run: (func: Function) => void
        var queueDelay: (func: Function, delay: number) => void
    }

    namespace Handlers {
        class FnHandler {
            blockable: boolean
            func: Function
            constructor(blockable: boolean, func?: Function)
            isActive(): boolean
            isBlockable(): boolean
            commit(): Function
        }
        class AltHandler {
            flag: Boxes.Box<boolean>
            func: Function
            constructor(flag: Boxes.Box<boolean>, func: Function)
            isActive(): boolean
            isBlockable(): boolean
            commit(): Function
        }

        type HandlerType = FnHandler | AltHandler
    }

    namespace Instructions {
        class TakeInstruction { }
        class PutInstruction { }
        class SleepInstruction { }
        class AltsInstruction { }
    }

    namespace Processes {
        const NO_VALUE: string
        var putThenCallback: (channel: Channel, value: any, callback?: Function) => void
        var takeThenCallback: (channel: Channel, callback?: Function) => void
        var take: (channel: Channel) => Instructions.TakeInstruction
        var put: (channel: Channel, value: any) => Instructions.PutInstruction
        var sleep: (msecs: number) => Instructions.SleepInstruction
        var alts: (operations: Channel[] | (Channel|any)[], options: any) => Instructions.AltsInstruction
        var poll: (channel: Channel) => any
        var offer: (channel: Channel, value: any) => boolean
        class Process { }
    }

    namespace Results {
        var DEFAULT: {
            toString(): string
        }

        class AltResult<T> {
            value: T
            channel: Channel | typeof DEFAULT
            constructor(value: T, channel: Channel | typeof DEFAULT)
        }
    }

    namespace Selects {
        var doAlts: (operations: Channel[] | (Channel|any)[], callback: Function, options: any) => void
    }

    namespace Timers {
        var timeout: (msecs: number) => Channel
    }

    namespace Utils {
        const taskScheduler: (func: Function, value: any) => void
        const isReduced: (v: any) => boolean
        /**export function flush<T> */
    }

    export type Channel = Chennals.Channel

    export type FixedBuffer<T> = Buffers.FixedBuffer<T>
    export type DroppingBuffer<T> = Buffers.DroppingBuffer<T>
    export type SlidingBuffer<T> = Buffers.SlidingBuffer<T>
    export type PromiseBuffer = Buffers.PromiseBuffer
    export type BufferType<T> = Buffers.BufferType<T>

    /**./csp.core.js */
    var core: {
        /**spawn a chennel */
        spawn(gen: Function, creator: Function): Channel
        go(f: Function, args?: any[]): Channel
        chan(n: number): Channel
        chan(buffer: BufferType<any>): Channel
        promiseChan(): Channel
    }

    /**./csp.operations.js */
    export var operations: {
        [index: string]: any
    }

    export const buffers: {
        fixed: typeof Buffers.fixed
        dropping: typeof Buffers.dropping
        sliding: typeof Buffers.sliding
        promise: typeof Buffers.promise
    }

    export var CLOSED: typeof Chennals.CLOSED

    export var timeout: typeof Timers.timeout

    export var DEFAULT: typeof Results.DEFAULT

    export var put: typeof Processes.put
    export var take: typeof Processes.take
    export var offer: typeof Processes.offer
    export var poll: typeof Processes.poll
    export var sleep: typeof Processes.sleep
    export var alts: typeof Processes.alts
    export var putAsync: typeof Processes.putThenCallback
    export var takeAsync: typeof Processes.takeThenCallback
    export var NO_VALUE: typeof Processes.NO_VALUE

    export var spawn: typeof core.spawn
    export var go: typeof core.go
    export var chan: typeof core.chan
    export var promiseChan: typeof core.promiseChan
}