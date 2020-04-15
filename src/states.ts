"use strict";

import { Machine } from "xstate";
import { TyperContext } from "./TyperContext";

const typerContext = {};

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
    context: typerContext,
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
            entry: ['disableIdling', 'enableRecording', 'startRecording'],
            exit: 'disableRecording',
            on: {
                DONE_RECORDING: 'idle'
            }
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