"use strict";

import { Machine } from "xstate";
import { TyperContext } from "./TyperContext";

const recordStates = {
    id: 'record',
    strict: true,
    initial: 'start',
    states: {
        start: {
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
    id: 'play',
    strict: true,
    initial: 'start',
    states: {
        start: {
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
            entry: ['playStopSound', 'pauseAutoPlay'],
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
    initial: 'idle',
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
            exit: 'disablePlaying',
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

export const typerMachine = Machine<TyperContext>(typerStates);