"use strict";

import { Machine } from "xstate";
export interface TyperContext { }

type TyperStateName = 'idle' | 'record' | 'play' | undefined;
const idle: TyperStateName = 'idle';
type RecordStateName = 'startRecord' | 'recording' | 'saving' | undefined;
const startRecord: RecordStateName = 'startRecord';
type PlayStateName = 'playing' | 'paused' | undefined;
const playing: PlayStateName = 'playing';
type AutoplayStateName = 'auto_off' | 'auto_on' | undefined;
const auto_off: AutoplayStateName = 'auto_off';
type AutoplayOnStateName = 'paused_auto' | 'playing_auto' | undefined;
const playing_auto: AutoplayOnStateName = 'playing_auto';
type NodeType = "parallel" | "atomic" | "compound" | "final" | "history" | undefined;
const parallel: NodeType = 'parallel';

const recordStates = {
    strict: true,
    initial: startRecord,
    states: {
        startRecord: {
            entry: ['disableIdling', 'enableRecording', 'startRecording'],
            on: {
                '': {
                    target: 'recording',
                    actions: 'showRecording'
                }
            }
        },
        recording: {
            on: {
                SAVE_RECORDING: 'saving'
            }
        },
        saving: {
            entry: ['showSaving', 'saveRecording'],
            on: {
                RECORDING_SAVED: '#idle',
                RECORDING_NOT_SAVED: {
                    target: 'recording',
                    actions: 'showRecordingNotSaved'
                }
            }
        }
    }
};

const playStates = {
    strict: true,
    type: parallel,
    states: {
        runPlay: {
            initial: playing,
            states: {
                playing: {
                    on: {
                        PLAY_PAUSED: {
                            target: 'paused',
                            actions: 'playPauseSound'
                        },
                        PLAY_PAUSED_AT_END: {
                            target: 'paused',
                            actions: ['playEndSound', 'showEnd']
                        }
                    }
                },
                paused: {
                    on: {
                        RESUME_PLAY: 'playing'
                    }
                },

            }
        },
        autoplay: {
            initial: auto_off,
            states: {
                auto_off: {
                    on: {
                        TOGGLE_AUTOPLAY: 'auto_on'
                    }
                },
                auto_on: {
                    on: {
                        TOGGLE_AUTOPLAY: {
                            target: 'auto_off',
                            actions: 'pauseAutoPlay'
                        }
                    },
                    initial: playing_auto,
                    states: {
                        playing_auto: {
                            entry: 'startAutoPlay',
                            on: {
                                PLAY_PAUSED: 'paused_auto',
                                PLAY_PAUSED_AT_END: 'paused_auto',
                            }
                        },
                        paused_auto: {
                            entry: 'pauseAutoPlay',
                            on: {
                                RESUME_PLAY: {
                                    target: 'playing_auto',
                                    actions: 'resumeAutoPlay'
                                }
                            }
                        }
                    }
                }
            }
        }
    }
};

const typerStates = {
    id: 'typer',
    strict: true,
    initial: idle,
    states: {
        idle: {
            id: 'idle',
            entry: 'enableIdling',
            on: {
                RECORD: 'record',
                PLAY: {
                    target: 'play',
                    actions: ['disableIdling', 'enablePlaying', 'startPlaying']
                }
            }
        },
        record: {
            on: {
                DONE_RECORDING: {
                    target: 'idle',
                    actions: 'showDoneRecording'
                },
                CANCELLED_RECORDING: {
                    target: 'idle',
                    actions: 'showCancelledRecording'
                },
                DISCARDED_RECORDING: {
                    target: 'idle',
                    actions: 'showDiscardedRecording'
                }
            },
            exit: 'disableRecording',
            ...recordStates
        },
        play: {
            on: {
                TOGGLE_SILENCE: {
                    actions: 'toggleSilence'
                },
                DONE_PLAYING: {
                    target: 'idle',
                    actions: 'showDonePlaying'
                },
                CANCELLED_PLAYING: {
                    target: 'idle',
                    actions: 'showCancelledPlaying'
                }
            },
            exit: ['quitAutoPlay', 'disablePlaying'],
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
                saving: {}
            }
        },
        play: {
            states: {
                runPlay: {
                    states: {
                        playing: {},
                        paused: {}
                    }
                },
                autoplay: {
                    states: {
                        auto_off: {},
                        auto_on: {
                            states: {
                                playing_auto: {},
                                paused_auto: {}
                            }
                        }
                    }
                }
            }
        }
    };
}

export type TyperEvent =
    | { type: 'RECORD' }
    | { type: 'PLAY' }
    | { type: 'DONE_RECORDING' }
    | { type: 'CANCELLED_RECORDING' }
    | { type: 'DISCARDED_RECORDING' }
    | { type: 'TOGGLE_SILENCE' }
    | { type: 'DONE_PLAYING' }
    | { type: 'CANCELLED_PLAYING' }
    | { type: 'SAVE_RECORDING' }
    | { type: 'RECORDING_SAVED' }
    | { type: 'RECORDING_NOT_SAVED' }
    | { type: 'RESUME_RECORDING' }
    | { type: 'PLAY_PAUSED' }
    | { type: 'PLAY_PAUSED_AT_END' }
    | { type: 'RESUME_PLAY' }
    | { type: 'TOGGLE_AUTOPLAY' };

export const typerMachine = Machine<TyperContext, TyperSchema, TyperEvent>(typerStates);
