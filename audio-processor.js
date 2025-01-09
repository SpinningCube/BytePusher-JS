const maxBufferSize = 256 * 4;

/**
 * AudioWorkletProcessor that reads samples from the main thread via the
 * AudioWorkletNode's MessagePort. The incoming samples get queued into the
 * internal sample buffer. The contents of the sample buffer eventually get
 * consumed and sent to output.
 */
class BytePusherAudioProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.audioBuffer = new Int8Array(0);
        this.port.onmessage = (event) => {
            // Receive audio buffer from main thread and merge with our audio buffer
            let mergedAudioBuffer = new Int8Array(this.audioBuffer.length + event.data.length);
            mergedAudioBuffer.set(this.audioBuffer);
            mergedAudioBuffer.set(event.data, this.audioBuffer.length);

            // If the audio buffer size exceeds the maximum allowed size,
            // remove samples from the beginning as necessary
            this.audioBuffer = mergedAudioBuffer.slice(Math.max(0, mergedAudioBuffer.length - maxBufferSize));
        };
    }

    process(inputs, outputs, parameters) {
        const output = outputs[0];
        const outputLength = output[0].length;
        const lengthToCopy = Math.min(outputLength, this.audioBuffer.length);
        
        // Copy buffer contents to output
        let sample = 0;
        for (; sample < lengthToCopy; sample++) {
            for (let channel = 0; channel < output.length; channel++) {
                // Convert from Int8 to the -1 to 1 floating point range.
                output[channel][sample] = this.audioBuffer[sample] / 127;
            }
        }
        
        // Remove outputted samples from the audio buffer
        this.audioBuffer = this.audioBuffer.slice(lengthToCopy);

        // Fill any remaining samples with zeroes
        for (; sample < outputLength; sample++) {
            for (let channel = 0; channel < output.length; channel++) {
                output[channel][sample] = 0;
            }
        }

        return true;
    }
}

registerProcessor('audio-processor', BytePusherAudioProcessor);