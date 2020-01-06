import * as mm from 'music-metadata';

const wavPlayer = require("node-wav-player");
const path = require("path");

const state = { isPlaying: false };

export async function playSound() {
    let soundFileName = "beep-26.wav";
    let soundFilePath = path.join(
        __dirname,
        "..",
        "sounds",
        soundFileName
    );

    let duration: number | undefined;
    await mm.parseFile(soundFilePath)
        .then(metadata => {
            duration = metadata.format.duration;
        })
        .catch((err) => {
            console.error(err.message);
        });

    state.isPlaying = true;
    wavPlayer
        .play({
            path: soundFilePath,
            sync: true
        })
        .then(() => {
            state.isPlaying = false;
        })
        .catch((error: any) => {
            console.error(error);
            state.isPlaying = true;
        });
    return new Promise(resolve => {
        resolve(duration);
    });
}
