import { Machine } from "xstate";
import { TyperContext } from "./stateTypes";

const playStates = {
    id: 'playing',
    strict: true,
    initial: 'start',
    states: {
        start: {
            entry: ['enablePlaying', 'startPlaying'],
            on: {
                '': 'playing'
            }
        },
        playing: {
            on: {
                PLAY_PAUSED: 'paused',
                REACHED_END: 'atEnd'
            }
        },
        paused: {
            entry: 'playStopSound',
            on: {
                RESUME_PLAY: 'playing'
            }
        },
        atEnd: {
            entry: 'playEndSound'
        }

    }
};

const typerStates = {
    id: 'typer',
    strict: true,
    initial: 'start',
    states: {
        start: {
            entry: 'registerTopLevelCommands',
            on: {
                '': 'idle' // the null event '' always occurs once the state is entered; causes immediate transition
            }
        },
        idle: {
            on: {
                RECORD: 'record',
                PLAY: 'play'
            }
        },
        record: {
            entry: ['enableRecording', 'startRecording'],
            exit: 'disableRecording',
            on: {
                DONE_RECORDING: 'idle'
            }
        },
        play: {
            exit: 'disablePlaying',
            on: {
                DONE_PLAYING: 'idle'
            },
            ...playStates
        }
    }
};

export const typerMachine = Machine<TyperContext>(typerStates);