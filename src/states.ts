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
                '': 'waiting' // null event '' always occurs once state is entered; causes immediate transition
            }
        },
        waiting: {
            on: {
                RECORD: 'recording',
                PLAY: 'playing'
            }
        },
        recording: {
            entry: ['enableRecording', 'startRecording'],
            exit: 'disableRecording',
            on: {
                PLAY: 'playing'
            }
        },
        playing: {
            entry: ['enablePlaying', 'startPlaying'],
            exit: 'disablePlaying',
            on: {
                DONE_PLAYING: 'waiting'
            }
        }
    }
};

export const typerMachine = Machine<TyperContext>(typerStates);