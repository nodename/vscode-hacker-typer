import { Machine } from "xstate";
import { TyperContext } from "./stateTypes";

const playingStates = {
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
                PLAY_PAUSED: 'paused'
            }
        },
        paused: {
            on: {
                RESUME_PLAY: 'playing'
            }
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
                RECORD: 'recording',
                PLAY: 'playing'
            }
        },
        recording: {
            entry: ['enableRecording', 'startRecording'],
            exit: 'disableRecording',
            on: {
                DONE_RECORDING: 'idle'
            }
        },
        playing: {
            exit: 'disablePlaying',
            on: {
                DONE_PLAYING: 'idle'
            },
            ...playingStates
        }
    }
};

export const typerMachine = Machine<TyperContext>(typerStates);