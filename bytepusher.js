// BytePusher VM

// Canvas context
const canvas = document.getElementById("bytepusherScreen");
const canvasContext = canvas.getContext("2d");

// Initialize framebuffer
const WIDTH = canvas.width = 256;
const HEIGHT = canvas.height = 256;
const framebuffer = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
for (let i = 3; i < framebuffer.length; i += 4) {
    framebuffer[i] = 255;
}

// Get audio context
const AudioContext = window.AudioContext || window.webkitAudioContext;
const audioContext = new AudioContext({ sampleRate: 15360 }); // 256 samples per frame at 60 FPS

// Create gain node
const gainNode = audioContext.createGain();
gainNode.connect(audioContext.destination);
gainNode.gain.value = 0.5;

// Volume control
const volumeControl = document.getElementById("volumeControl");
volumeControl.value = gainNode.gain.value;
volumeControl.addEventListener("input", function(event) {
    gainNode.gain.value = event.target.value;
})

// Create an audio worklet
let audioProcessor = null;
audioContext.audioWorklet?.addModule("audio-processor.js").then(function() {
    audioProcessor = new AudioWorkletNode(audioContext, "audio-processor");
    audioProcessor.connect(gainNode);
});

// Web browsers don't allow audio to start playing before the
// user has interacted with the page, so web audio contexts
// cannot start playing before then.
// This code resumes the audio context on the first page click.
document.addEventListener("click", function() {
    if (audioContext.state === "suspended") {
        audioContext.resume();
    }
}, { once: true });

// Initial state
const ramSize = 16777216;
const ram = new Uint8Array(ramSize + 8); // RAM, with an extra 8 padding bytes to handle out of bounds accesses
let pc = 0; // Program Counter
let programToLoad = [];
let keysPressed = 0; // 16-bit value containing keypad state

/*
 * Keyboard input
 * BytePusher uses a hexadecimal keypad like that used by the CHIP-8.
 * This emulator maps it to the left four columns of the QWERTY keyboard:
 * 
 *   1 2 3 C <-> 1 2 3 4
 *   4 5 6 D <-> Q W E R
 *   7 8 9 E <-> A S D F
 *   A 0 B F <-> Z X C V
 * 
 */
const keys = ["KeyX", "Digit1", "Digit2", "Digit3", "KeyQ", "KeyW", "KeyE", "KeyA", "KeyS", "KeyD", "KeyZ", "KeyC", "Digit4", "KeyR", "KeyF", "KeyV"];
document.addEventListener('keydown', function(event) {
    // Simple loop over all possible keys
    for (let i = 0; i < keys.length; i++) {
        if (event.code === keys[i]) {
            keysPressed |= 1 << i;
            return;
        }
    }
});
document.addEventListener('keyup', function(event) {
    // Simple loop over all possible keys
    for (let i = 0; i < keys.length; i++) {
        if (event.code === keys[i]) {
            keysPressed &= ~(1 << i) & 0xFFFF;
            return;
        }
    }
});

// Demos
const demoList = [
    ["Palette Test by Javamannen", "PaletteTest.BytePusher"],
    ["Scrolling Logo by Javamannen", "ScrollingLogo.BytePusher"],
    ["Keyboard Test by Javamannen", "KeyboardTest.BytePusher"],
    ["Munching Squares by Zzo38", "Munching_Squares.BytePusher"],
    ["Audio Test by Javamannen", "AudioTest.BytePusher"],
    ["SineScroller by Javamannen", "SineScroller.BytePusher"],
    ["Sprites by Javamannen", "Sprites.BytePusher"],
    ["\"Invert Loop\" sine by Ben Russell", "invertloopsine.BytePusher"],
    ["Nyan Cat by Nucular", "nyan.bp"],
    ["Console Test by gamemanj", "ConsoleTest.BytePusher"],
    ["Langton ant by JulienDelplanque", "langton_ant2.BytePusher"]
];

// Program select dropdown
const programSelectDropdown = document.getElementById("programSelect");

for (let i = 0; i < demoList.length; i++) {
    let optionElement = document.createElement('option');
    optionElement.value = i;
    optionElement.textContent = demoList[i][0];
    programSelectDropdown.appendChild(optionElement);
}

// File input
const programFileInput = document.getElementById("programFileInput");
programFileInput.addEventListener("change", function(event) {
    const fileList = event.target.files;
    if (fileList.length !== 0) {
        const file = fileList[0];
        const reader = new FileReader();
        reader.addEventListener("load", function() {
            programToLoad = new Uint8Array(reader.result);
        });
        reader.readAsArrayBuffer(file);
    }
});

// Load button
const loadButton = document.getElementById("loadProgram");
loadButton.addEventListener("click", async function() {
    //audioContext.resume();
    const selection = programSelectDropdown.value;
    if (selection == "from-file") {
        // Open file dialogue
        programFileInput.click();
    } else {
        // Load demo
        loadDemo(parseInt(selection));
    }
});

async function loadDemo(index) {
    const response = await fetch(`demos/${demoList[index][1]}`);
    const programBlob = await response.blob();
    const arrayBuffer = await programBlob.arrayBuffer();
    programToLoad = new Uint8Array(arrayBuffer);
}

loadDemo(6);
programSelectDropdown.value = "6";

// Emulation speed
const FPS = 60;
const IPF = 65536; // Instructions per frame
const IPMS = IPF * FPS * 0.001; // Instructions per millisecond
let speedModifier = 1;
let paused = false;
let frame = 0;

const speedControl = document.getElementById("speedControl");
const speedDisplay = document.getElementById("speedDisplay");
speedControl.addEventListener("input", function(event) {
    const speedPercentage = event.target.value;
    speedDisplay.value = Math.round(speedPercentage);
    speedModifier = speedPercentage * 0.01;
})

// Pause button
const pauseButton = document.getElementById("pauseVM");
pauseButton.addEventListener("click", function() {
    if (paused) {
        paused = false;
        pauseButton.textContent = "Pause";
    } else {
        paused = true;
        pauseButton.textContent = "Resume";
    }
});

// Counters
let prevTime = performance.now();
let fpsTimer = 0;
let frameUpdated = false;
let instructionCount = IPF;
let instructionsLeft = 0;
const fpsDisplay = document.getElementById("fpsDisplay");

/**
 * Runs the main loop of the VM for the provided number of instructions.
 * @param {number} numInstructions number of instructions to run.
 */
function run(numInstructions) {
    // Check if there is a program to load
    // If so, copy it into RAM and reset the system
    if (programToLoad.length > 0) {
        ram.fill(0);
        for (let i = 0; i < Math.min(programToLoad.length, ramSize); i++) {
            ram[i] = programToLoad[i];
        }
        programToLoad = [];
        instructionCount = IPF;
    }

    /*
     * From https://esolangs.org/wiki/BytePusher:
     * 1. Wait for the next timer tick (60 ticks are generated per second).
     * 2. Poll the keys and store their states as a 2-byte value at address 0.
     * 3. Fetch the 3-byte program counter from address 2, and execute exactly 65536 instructions.
     * 4. Send the 64-KiB pixeldata block designated by the byte value at address 5 to the display device.
     *    Send the 256-byte sampledata block designated by the 2-byte value at address 6 to the audio device.
     * 5. Go back to step 1.
     */

    instructionsLeft += numInstructions;

    // Execute instructions
    while (instructionsLeft >= 1) {
        if (instructionCount >= IPF) {
            // End of the frame
            updateOutput();

            // Poll the keys and store their states as a 2-byte value at address 0
            ram[0] = keysPressed >>> 8;
            ram[1] = keysPressed & 0xFF;

            // Fetch the 3-byte program counter from address 2
            pc = (ram[2] << 16) | (ram[3] << 8) | ram[4];

            instructionCount = 1;
        } else {
            instructionCount++;
        }

        // Execute one instruction
        // 1. Read value from address provided in first operand
        const readAddress = (ram[pc] << 16) | (ram[pc + 1] << 8) | ram[pc + 2];
        const readValue = ram[readAddress];

        // 2. Write value to address provided in second operand
        const writeAddress = (ram[pc + 3] << 16) | (ram[pc + 4] << 8) | ram[pc + 5];
        ram[writeAddress] = readValue;

        // 3. Jump to address provided in third and final operand
        pc = (ram[pc + 6] << 16) | (ram[pc + 7] << 8) | ram[pc + 8];

        instructionsLeft--;
    }
}

/**
 * Update audio and framebuffer based on contents of RAM.
 */
function updateOutput() {
    if (audioProcessor != null) {
        // Output audio buffer from RAM
        outputSamples = new Int8Array(256);
        audioStartIndex = ((ram[6] << 8) | ram[7]) << 8;
        for (let i = 0; i < 256; i++) {
            outputSamples[i] = ram[audioStartIndex | i];
        }
        // Send buffer of 256 samples to audio processor
        audioProcessor.port.postMessage(outputSamples);
    }

    // Output framebuffer from RAM
    frameStartIndex = ram[5] << 16;
    for (let i = 0; i < 65536; i++) {
        let currentPixel = ram[frameStartIndex + i];
        if (currentPixel < 216) {
            framebuffer[4 * i] = 51 * (Math.floor(currentPixel / 36));
            framebuffer[4 * i + 1] = 51 * (Math.floor(currentPixel / 6) % 6);
            framebuffer[4 * i + 2] = 51 * (currentPixel % 6);
        } else {
            framebuffer[4 * i] = 0;
            framebuffer[4 * i + 1] = 0;
            framebuffer[4 * i + 2] = 0;
        }
        framebuffer[4 * i + 3] = 255;
    }

    frame++;
    frameUpdated = true;
}

/**
 * Callback function for `requestAnimationFrame`, runs the VM.
 * @param {DOMHighResTimeStamp} timestamp 
 */
function perFrame(timestamp) {
    // Delta time
    let deltaTime = Math.min(50, (timestamp - prevTime));
    prevTime = timestamp;

    if (!paused) {
        // FPS counter
        fpsTimer -= deltaTime;
        if (fpsTimer <= 0) {
            fpsDisplay.value = frame;
            fpsTimer += 1000;
            frame = 0;
        }
        
        // Run BytePusher
        run(IPMS * speedModifier * deltaTime);
        
        if (frameUpdated) {
            // Send new frame to canvas
            const imageData = new ImageData(framebuffer, WIDTH, HEIGHT);
            canvasContext.putImageData(imageData, 0, 0);
            frameUpdated = false;
        }
    }
    requestAnimationFrame(perFrame);
}

requestAnimationFrame(perFrame);