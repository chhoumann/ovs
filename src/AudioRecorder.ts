import { logger } from "./logging";
import { TypedEvents } from "./types/TypedEvents";

interface AudioRecorderEvents {
	dataAvailable: (data: Blob) => void;
	recordingComplete: (data: { buffer: ArrayBuffer; mimeType: string }) => void;
	recordingStarted: () => void;
	recordingStopped: () => void;
	recordingCancelled: (error: Error) => void;
	teardown: () => void;
	error: (error: unknown) => void;
}

export class AudioRecorder extends TypedEvents<AudioRecorderEvents> {
	private mediaRecorder: MediaRecorder | null = null;
	private audioChunks: Blob[] = [];
	private recordingPromise: Promise<{
		buffer: ArrayBuffer;
		mimeType: string;
	}> | null = null;
	private resolveRecording:
		| ((value: { buffer: ArrayBuffer; mimeType: string }) => void)
		| null = null;
	private rejectRecording: ((reason: unknown) => void) | null = null;
	private audioContext: AudioContext | null = null;
	private analyser: AnalyserNode | null = null;

	private getMimeTypeExtension(mimeType: string): string {
		const mimeToExtMap: { [key: string]: string } = {
			"audio/webm": "webm",
			"audio/ogg": "ogg",
			"audio/wav": "wav",
			"audio/mpeg": "mp3",
			"audio/mp4": "mp4",
			"audio/x-m4a": "m4a",
			"audio/flac": "flac",
		};

		// Remove codecs information if present
		const baseMimeType = mimeType.split(";")[0];
		return mimeToExtMap[baseMimeType] || "webm"; // Default to 'webm' if unknown
	}

	private handleDataAvailable = (event: BlobEvent) => {
		this.audioChunks.push(event.data);
		this.trigger("dataAvailable", event.data);
	};

	private handleStop = () => {
		const fullMimeType = this.mediaRecorder?.mimeType || "audio/webm";
		const mimeType = this.getMimeTypeExtension(fullMimeType);
		const audioBlob = new Blob(this.audioChunks, { type: fullMimeType });
		audioBlob.arrayBuffer().then((buffer) => {
			if (this.resolveRecording) {
				this.resolveRecording({ buffer, mimeType });
				this.trigger("recordingComplete", { buffer, mimeType });
			}
		});
		this.trigger("recordingStopped");
	};

	teardown() {
		this.trigger("teardown");

		if (this.mediaRecorder) {
			this.mediaRecorder.removeEventListener(
				"dataavailable",
				this.handleDataAvailable,
			);
			this.mediaRecorder.removeEventListener("stop", this.handleStop);
			for (const track of this.mediaRecorder.stream.getTracks()) {
				track.stop();
			}
			this.mediaRecorder = null;
		}

		if (this.audioContext) {
			if (this.audioContext.state !== "closed") {
				this.audioContext.close();
			}

			this.audioContext = null;
			this.analyser = null;
		}

		this.audioChunks = [];
		this.recordingPromise = null;
		this.resolveRecording = null;
		this.rejectRecording = null;
	}

	async start(): Promise<void> {
		if (this.mediaRecorder && this.mediaRecorder.state === "recording") {
			throw new Error("Recording is already in progress");
		}

		try {
			const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
			this.mediaRecorder = new MediaRecorder(stream);
			this.audioChunks = [];

			this.mediaRecorder.addEventListener(
				"dataavailable",
				this.handleDataAvailable,
			);
			this.mediaRecorder.addEventListener("stop", this.handleStop);

			this.recordingPromise = new Promise((resolve, reject) => {
				this.resolveRecording = resolve;
				this.rejectRecording = reject;
			});

			this.audioContext = new AudioContext();
			const source = this.audioContext.createMediaStreamSource(stream);
			this.analyser = this.audioContext.createAnalyser();
			this.analyser.fftSize = 256;
			source.connect(this.analyser);

			this.mediaRecorder.start();
			this.trigger("recordingStarted");
		} catch (error) {
			logger.error("Error starting recording", { error });
			this.trigger("error", error);
			throw error;
		}
	}

	stop(): Promise<{ buffer: ArrayBuffer; mimeType: string }> {
		if (!this.mediaRecorder || this.mediaRecorder.state !== "recording") {
			const error = new Error("No active recording to stop");
			this.trigger("error", error);
			return Promise.reject(error);
		}

		this.mediaRecorder.stop();

		for (const track of this.mediaRecorder.stream.getTracks()) {
			track.stop();
		}

		return (
			this.recordingPromise ??
			Promise.reject(new Error("Recording promise not initialized"))
		);
	}

	cancel(): void {
		if (this.mediaRecorder && this.mediaRecorder.state === "recording") {
			this.mediaRecorder.stop();
			if (this.rejectRecording) {
				const error = new Error("Recording cancelled");
				this.rejectRecording(error);
				this.trigger("recordingCancelled", error);
			}
		}

		this.teardown();
	}

	isRecording(): boolean {
		return (
			this.mediaRecorder !== null && this.mediaRecorder.state === "recording"
		);
	}

	getAnalyser(): AnalyserNode | null {
		return this.analyser;
	}
}
