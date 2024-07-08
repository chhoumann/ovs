import { Notice, Plugin, TFile } from "obsidian";
import { AudioRecorder } from "./AudioRecorder";
import {
	DEFAULT_SETTINGS,
	type OVSPluginSettings,
	OVSSettingTab,
} from "./OVSSettingTab";
import {
	CreateNoteAction,
	NoopAction,
	TranscribeAction,
} from "./actions/Action";
import { ActionManager } from "./actions/ActionManager";
import { AIManager } from "./ai";
import { registerCommands } from "./commands";
import { WaveformVisualizer } from "./components/WaveformVisualizer";

export default class OVSPlugin extends Plugin {
	settings!: OVSPluginSettings;
	actionManager!: ActionManager;

	private audioRecorder: AudioRecorder = new AudioRecorder();
	private aiManager!: AIManager;
	private _isRecording = false;
	private recordingNotice: Notice | null = null;
	private waveformVisualizer: WaveformVisualizer | null = null;

	public get isRecording(): boolean {
		return this._isRecording;
	}

	override async onload() {
		await this.loadSettings();
		this.actionManager = new ActionManager();

		this.actionManager.registerAction(new CreateNoteAction());
		this.actionManager.registerAction(new NoopAction());
		this.actionManager.registerAction(new TranscribeAction());

		this.aiManager = new AIManager(this, this.actionManager.getAllActionIds());

		registerCommands(this);

		this.addSettingTab(new OVSSettingTab(this.app, this));

		// Replace the existing ribbon icon with a push-to-talk button
		this.addRibbonIcon("mic", "Push to talk", (evt: MouseEvent) => {
			if (evt.type === "mousedown") {
				this.startRecording();
			} else if (evt.type === "mouseup" || evt.type === "mouseleave") {
				this.stopRecording();
			}
		});

		// Add event listeners for the push-to-talk button
		// Register the push-to-talk button
		const ribbonIcon = this.addRibbonIcon("mic", "Push to talk", () => {});
		this.registerDomEvent(
			ribbonIcon,
			"mousedown",
			this.startRecording.bind(this),
		);
		this.registerDomEvent(ribbonIcon, "mouseup", this.stopRecording.bind(this));
		this.registerDomEvent(
			ribbonIcon,
			"mouseleave",
			this.stopRecording.bind(this),
		);

		// Register event listeners for the AudioRecorder
		this.registerEvent(
			this.audioRecorder.on("recordingStarted", () => {
				console.log("Recording started");
				this.recordingNotice = new Notice("", 99999999);
				this.createWaveform(this.recordingNotice.noticeEl.createEl("div"));
			}),
		);

		this.registerEvent(
			this.audioRecorder.on(
				"recordingComplete",
				async (buffer: ArrayBuffer) => {
					console.log("Recording complete");
					await this.processRecording(buffer);
					this.recordingNotice?.hide();
					this.recordingNotice = null;
					this.stopWaveform();
				},
			),
		);

		this.registerEvent(
			this.audioRecorder.on("error", (error: unknown) => {
				console.error("Recording error:", error);
				this.recordingNotice?.setMessage(
					`Error during recording: ${error instanceof Error ? error.message : String(error)}`,
				);
				setTimeout(() => {
					this.recordingNotice?.hide();
					this.recordingNotice = null;
				}, 5000);
			}),
		);
	}

	async startRecording() {
		if (this.isRecording) return;

		try {
			await this.audioRecorder.start();
			this._isRecording = true;
		} catch (error) {
			console.error("Error starting recording:", error);
			this._isRecording = false;
		}
	}

	async stopRecording() {
		if (!this.isRecording) return;

		try {
			await this.audioRecorder.stop();
			this._isRecording = false;
		} catch (error) {
			console.error("Error stopping recording:", error);
		}
	}

	override onunload() {
		try {
			if (this.audioRecorder) {
				this.audioRecorder.cancel();
				this.audioRecorder.teardown();
			}
		} catch (error) {
			console.error("Error during plugin unload:", error);
		}
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	private async processRecording(audioBuffer: ArrayBuffer) {
		try {
			const transcription = await this.aiManager.transcribeAudio(audioBuffer);

			const filePath = "dev/transcription.md";
			const file = this.app.vault.getAbstractFileByPath(filePath);
			if (file && file instanceof TFile) {
				this.app.vault.modify(file, transcription).catch((error) => {
					console.error("Error modifying file:", error);
				});
			} else {
				this.app.vault.create(filePath, transcription).catch((error) => {
					console.error("Error creating file:", error);
				});
			}

			await this.aiManager.run(transcription);
		} catch (error) {
			console.error("Error processing recording:", error);
		}
	}

	private createWaveform(waveformContainer: HTMLDivElement) {
		const analyser = this.audioRecorder.getAnalyser();
		if (!analyser) return;

		this.waveformVisualizer = new WaveformVisualizer(
			waveformContainer,
			analyser,
		);
		this.waveformVisualizer.start();
	}

	private stopWaveform() {
		if (this.waveformVisualizer) {
			this.waveformVisualizer.stop();
			this.waveformVisualizer = null;
		}
	}
}
