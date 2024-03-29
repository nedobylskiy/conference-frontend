// @flow

import * as bodyPix from '@tensorflow-models/body-pix';
import {
    CLEAR_INTERVAL,
    INTERVAL_TIMEOUT,
    SET_INTERVAL,
    timerWorkerScript
} from './TimerWorker';

/**
 * Выполнять размытие только каждые 2 кадра
 * @type {number}
 */
export const FRAME_REPEAT_THRESHOLD = 10;

/**
 * Represents a modified MediaStream that adds blur to video background.
 * <tt>BackgroundReplacer</tt> does the processing of the original
 * video stream.
 */
export default class BackgroundReplacer {
    _bpModel: Object;
    _inputVideoElement: HTMLVideoElement;
    _onMaskFrameTimer: Function;
    _maskFrameTimerWorker: Worker;
    _maskInProgress: boolean;
    _outputCanvasElement: HTMLCanvasElement;
    _renderMask: Function;
    _segmentationData: Object;
    isEnabled: Function;
    startEffect: Function;
    stopEffect: Function;
    _frameCounter: number;

    /**
     * Represents a modified video MediaStream track.
     *
     * @class
     * @param {BodyPix} bpModel - BodyPix model.
     */
    constructor(bpModel: Object) {
        this._bpModel = bpModel;

        // Bind event handler so it is only bound once for every instance.
        this._onMaskFrameTimer = this._onMaskFrameTimer.bind(this);

        // Workaround for FF issue https://bugzilla.mozilla.org/show_bug.cgi?id=1388974
        this._outputCanvasElement = document.createElement('canvas');
        this._outputCanvasElement.getContext('2d');
        this._inputVideoElement = document.createElement('video');

        this._maskFrameTimerWorker = new Worker(timerWorkerScript, {name: 'Blur effect worker'});
        this._maskFrameTimerWorker.onmessage = this._onMaskFrameTimer;
    }

    /**
     * EventHandler onmessage for the maskFrameTimerWorker WebWorker.
     *
     * @private
     * @param {EventHandler} response - The onmessage EventHandler parameter.
     * @returns {void}
     */
    async _onMaskFrameTimer(response: Object) {
        if(response.data.id === INTERVAL_TIMEOUT) {
            if(!this._maskInProgress) {
                console.time('FRAME')
                await this._renderMask();
                console.timeEnd('FRAME')
            }
        }
    }

    /**
     * Loop function to render the background mask.
     *
     * @private
     * @returns {void}
     */
    async _renderMask() {
        this._frameCounter++;
        this._maskInProgress = true;

        if(this._frameCounter % FRAME_REPEAT_THRESHOLD === 0) {
            this._segmentationData = await this._bpModel.segmentPerson(this._inputVideoElement, {
                internalResolution: 0.1, // resized to 0.5 times of the original resolution before inference
                maxDetections: 1, // max. number of person poses to detect per image
                segmentationThreshold: 0.7 // represents probability that a pixel belongs to a person
            });
        }

        this._maskInProgress = false;
        bodyPix.drawBokehEffect(
            this._outputCanvasElement,
            this._inputVideoElement,
            this._segmentationData,
            5, // Constant for background blur, integer values between 0-20
            18 // Constant for edge blur, integer values between 0-20
        );
    }

    /**
     * Checks if the local track supports this effect.
     *
     * @param {JitsiLocalTrack} jitsiLocalTrack - Track to apply effect.
     * @returns {boolean} - Returns true if this effect can run on the specified track
     * false otherwise.
     */
    isEnabled(jitsiLocalTrack: Object) {
        return jitsiLocalTrack.isVideoTrack() && jitsiLocalTrack.videoType === 'camera';
    }

    /**
     * Starts loop to capture video frame and render the segmentation mask.
     *
     * @param {MediaStream} stream - Stream to be used for processing.
     * @returns {MediaStream} - The stream with the applied effect.
     */
    startEffect(stream: MediaStream) {
        const firstVideoTrack = stream.getVideoTracks()[0];
        const {height, frameRate, width}
            = firstVideoTrack.getSettings ? firstVideoTrack.getSettings() : firstVideoTrack.getConstraints();

        console.log('GET VIDEO', {height, frameRate, width});

        this._frameCounter = 0;

        this._outputCanvasElement.width = parseInt(width, 10);
        this._outputCanvasElement.height = parseInt(height, 10);
        this._inputVideoElement.width = parseInt(width, 10);
        this._inputVideoElement.height = parseInt(height, 10);
        this._inputVideoElement.autoplay = true;
        this._inputVideoElement.srcObject = stream;
        this._inputVideoElement.onloadeddata = () => {
            this._maskFrameTimerWorker.postMessage({
                id: SET_INTERVAL,
                timeMs: 1000 / parseInt(frameRate, 10)
            });
        };

        return this._outputCanvasElement.captureStream(parseInt(frameRate, 10));
    }

    /**
     * Stops the capture and render loop.
     *
     * @returns {void}
     */
    stopEffect() {
        this._maskFrameTimerWorker.postMessage({
            id: CLEAR_INTERVAL
        });
    }
}
