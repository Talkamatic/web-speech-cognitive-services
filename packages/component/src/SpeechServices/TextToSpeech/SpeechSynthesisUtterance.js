/* eslint no-empty: ["error", { "allowEmptyCatch": true }] */

import EventAsPromise from 'event-as-promise';

import DOMEventEmitter from '../../Util/DOMEventEmitter';
import fetchSpeechData from './fetchSpeechData';
import subscribeEvent from './subscribeEvent';

function asyncDecodeAudioData(audioContext, arrayBuffer) {
  return new Promise((resolve, reject) => {
    const promise = audioContext.decodeAudioData(arrayBuffer, resolve, reject);

    // Newer implementation of "decodeAudioData" will return a Promise
    promise && typeof promise.then === 'function' && resolve(promise);
  });
}

function playDecoded(audioContext, audioBuffer, source) {
  return new Promise((resolve, reject) => {
    const audioContextClosed = new EventAsPromise();
    const sourceEnded = new EventAsPromise();
    const unsubscribe = subscribeEvent(audioContext, 'statechange', ({ target: { state } }) => state === 'closed' && audioContextClosed.eventListener());

    try {
      source.buffer = audioBuffer;
      // "ended" may not fire if the underlying AudioContext is closed prematurely
      source.onended = sourceEnded.eventListener;

      source.connect(audioContext.destination);
      source.start(0);

      Promise.race([
        audioContextClosed.upcoming(),
        sourceEnded.upcoming()
      ]).then(resolve);
    } catch (err) {
      reject(err);
    } finally {
      unsubscribe();
    }
  });
}

export default class extends DOMEventEmitter {
  constructor(text) {
    super(['boundary', 'end', 'error', 'mark', 'pause', 'resume', 'start']);

    this._lang = null;
    this._pitch = 1;
    this._rate = 1;
    this._voice = null;
    this._volume = 1;

    this.text = text;

    this.onboundary = null;
    this.onend = null;
    this.onerror = null;
    this.onmark = null;
    this.onpause = null;
    this.onresume = null;
    this.onstart = null;
  }

  get lang() { return this._lang; }
  set lang(value) { this._lang = value; }

  get pitch() { return this._pitch; }
  set pitch(value) { this._pitch = value; }

  get rate() { return this._rate; }
  set rate(value) { this._rate = value; }

  get voice() { return this._voice; }
  set voice(value) { this._voice = value; }

  get volume() { return this._volume; }
  set volume(value) { this._volume = value; }

  async preload({
    authorizationTokenPromise,
    deploymentId,
    outputFormat,
    region
  }) {
    this.arrayBufferPromise = fetchSpeechData({
      authorizationTokenPromise,
      deploymentId,
      lang: this.lang || window.navigator.language,
      outputFormat,
      pitch: this.pitch,
      rate: this.rate,
      region,
      text: this.text,
      voice: this.voice && this.voice.voiceURI,
      volume: this.volume
    });

    // We need to call "await" to make sure the Promise is running.
    // We will ignore the reject result and handled in play() later.
    try {
      await this.arrayBufferPromise;
    } catch (err) {}
  }

  async play(audioContext) {
    try {
      // We should emit "start" event even if preload() failed.
      this.emit('start');

      // HACK: iOS requires bufferSourceNode to be constructed before decoding data.
      const source = audioContext.createBufferSource();
      const audioBuffer = await asyncDecodeAudioData(audioContext, await this.arrayBufferPromise);

      this._playingSource = source;

      await playDecoded(audioContext, audioBuffer, source);

      this._playingSource = null;
      this.emit('end');
    } catch (error) {
      this.emit('error', { error });
    }
  }

  stop() {
    this._playingSource && this._playingSource.stop();
  }
}
