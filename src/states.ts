import { Machine } from "xstate";
import { TyperContext } from "./stateTypes";

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
            entry: ['enablePlaying', 'startPlaying'],
            exit: 'disablePlaying',
            on: {
                DONE_PLAYING: 'idle'
            }
        }
    }
};

export const typerMachine = Machine<TyperContext>(typerStates);