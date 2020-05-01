"use strict";

import { Machine } from "xstate";
export interface TyperContext { }

type TyperStateName = 'idle' | 'record' | 'play' | undefined;
const idle: TyperStateName = 'idle';
type RecordStateName = 'startRecord' | 'recording' | 'saving' | 'saved' | 'resumed' | undefined;
const startRecord: RecordStateName = 'startRecord';
type PlayStateName = 'startPlay' | 'playing' | 'paused' | 'atEnd' | undefined;
const startPlay: PlayStateName = 'startPlay';

const recordStates = {
    strict: true,
    initial: startRecord,
    states: {
        startRecord: {
            entry: ['disableIdling', 'enableRecording', 'startRecording'],
            on: {
                '': 'recording'
            }
        },
        recording: {
            on: {
                SAVE_RECORDING: 'saving'
            }
        },
        saving: {
            entry: 'saveRecording',
            on: {
                RECORDING_SAVED: 'saved',
                RECORDING_NOT_SAVED: 'recording'
            }
        },
        saved: {
            entry: 'continueOrEndRecording',
            on: {
                RESUME_RECORDING: 'resumed'
            }
        },
        resumed: {
            entry: 'resumeRecording',
            on: {
                SAVE_RECORDING: 'saving'
            }
        }
    }
};

const playStates = {
    strict: true,
    initial: startPlay,
    states: {
        startPlay: {
            entry: ['disableIdling', 'enablePlaying', 'startPlaying'],
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
            entry: ['playPauseSound', 'pauseAutoPlay'],
            exit: 'resumeAutoPlay',
            on: {
                RESUME_PLAY: 'playing'
            }
        },
        atEnd: {
            entry: ['playEndSound', 'stopAutoPlay']
        }
    }
};

const typerStates = {
    id: 'typer',
    strict: true,
    initial: idle,
    states: {
        idle: {
            entry: 'enableIdling',
            on: {
                RECORD: 'record',
                PLAY: 'play'
            }
        },
        record: {
            exit: 'disableRecording',
            on: {
                DONE_RECORDING: 'idle'
            },
            ...recordStates
        },
        play: {
            exit: ['stopAutoPlay', 'disablePlaying'],
            on: {
                TOGGLE_SILENCE: {
                    actions: 'toggleSilence'
                },
                DONE_PLAYING: 'idle'
            },
            ...playStates
        }
    }
};

export interface TyperSchema {
    states: {
        idle: {},
        record: {
            states: {
                startRecord: {},
                recording: {},
                saving: {},
                saved: {},
                resumed: {}
            }
        },
        play: {
            states: {
                startPlay: {},
                playing: {},
                paused: {},
                atEnd: {}
            }
        }
    };
}

export type TyperEvent = 
    | { type: 'RECORD' }
    | { type: 'PLAY' }
    | { type: 'DONE_RECORDING' }
    | { type: 'TOGGLE_SILENCE' }
    | { type: 'DONE_PLAYING' }
    | { type: 'SAVE_RECORDING' }
    | { type: 'RECORDING_SAVED' }
    | { type: 'RECORDING_NOT_SAVED' }
    | { type: 'RESUME_RECORDING' }
    | { type: 'PLAY_PAUSED' }
    | { type: 'REACHED_END' }
    | { type: 'RESUME_PLAY' };

export const typerMachine = Machine<TyperContext, TyperSchema, TyperEvent>(typerStates);