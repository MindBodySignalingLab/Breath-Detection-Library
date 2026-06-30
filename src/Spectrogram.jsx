import { useEffect, useRef, useState } from 'react'

const FFT_SIZE = 1024
const CANVAS_WIDTH = 800
const CANVAS_HEIGHT = 512
const MAX_RECORDING_MS = 120000
const MICROPHONE_GAIN = 64
const BREATH_STEPS = [
  { label: 'inhale', minMs: 4000, maxMs: 6000 },
  { label: 'pause', minMs: 1000, maxMs: 2000 },
  { label: 'exhale', minMs: 4000, maxMs: 6000 },
  { label: 'pause', minMs: 1000, maxMs: 2000 },
]

function randomDuration(minMs, maxMs) {
  return Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs
}

export function Spectrogram({ onRecordingComplete }) {
  const canvasRef = useRef(null)
  const animationFrameRef = useRef(null)
  const streamRef = useRef(null)
  const audioContextRef = useRef(null)
  const analyserRef = useRef(null)
  const mediaRecorderRef = useRef(null)
  const recordingTimeoutRef = useRef(null)
  const instructionTimeoutRef = useRef(null)
  const progressIntervalRef = useRef(null)
  const recordingStartedAtRef = useRef(0)
  const instructionIndexRef = useRef(0)
  const phaseStartedAtRef = useRef(0)
  const phaseDurationRef = useRef(0)
  const labelsRef = useRef([])
  const chunksRef = useRef([])
  const [isRecording, setIsRecording] = useState(false)
  const [recordedBlob, setRecordedBlob] = useState(null)
  const [audioUrl, setAudioUrl] = useState(null)
  const [currentInstruction, setCurrentInstruction] = useState('Ready')
  const [phaseProgress, setPhaseProgress] = useState(0)
  const [phaseSecondsLeft, setPhaseSecondsLeft] = useState(0)

  function getElapsedMs() {
    return Math.max(0, Date.now() - recordingStartedAtRef.current)
  }

  function updatePhaseProgress() {
    if (!phaseStartedAtRef.current || !phaseDurationRef.current) {
      setPhaseProgress(0)
      setPhaseSecondsLeft(0)
      return
    }

    const elapsedMs = Date.now() - phaseStartedAtRef.current
    const progress = Math.min(1, elapsedMs / phaseDurationRef.current)
    const remainingMs = Math.max(0, phaseDurationRef.current - elapsedMs)

    setPhaseProgress(progress)
    setPhaseSecondsLeft(Math.ceil(remainingMs / 1000))
  }

  function finishCurrentLabel(endMs) {
    const lastLabel = labelsRef.current.at(-1)

    if (!lastLabel || lastLabel.endMs !== null) {
      return
    }

    lastLabel.endMs = endMs
    lastLabel.durationMs = Math.max(0, endMs - lastLabel.startMs)
  }

  function scheduleNextInstruction() {
    if (!isRecording && recordingStartedAtRef.current === 0) {
      return
    }

    const step = BREATH_STEPS[instructionIndexRef.current]
    const startMs = getElapsedMs()
    const durationMs = randomDuration(step.minMs, step.maxMs)

    finishCurrentLabel(startMs)
    setCurrentInstruction(step.label)

    labelsRef.current.push({
      label: step.label,
      startMs,
      endMs: null,
      durationMs: null,
    })

    phaseStartedAtRef.current = Date.now()
    phaseDurationRef.current = durationMs
    updatePhaseProgress()

    instructionIndexRef.current = (instructionIndexRef.current + 1) % BREATH_STEPS.length

    instructionTimeoutRef.current = setTimeout(() => {
      if (mediaRecorderRef.current?.state === 'recording') {
        scheduleNextInstruction()
      }
    }, durationMs)
  }

  function stopRecording() {
    if (recordingTimeoutRef.current !== null) {
      clearTimeout(recordingTimeoutRef.current)
      recordingTimeoutRef.current = null
    }

    if (instructionTimeoutRef.current !== null) {
      clearTimeout(instructionTimeoutRef.current)
      instructionTimeoutRef.current = null
    }

    if (progressIntervalRef.current !== null) {
      clearInterval(progressIntervalRef.current)
      progressIntervalRef.current = null
    }

    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current)
      animationFrameRef.current = null
    }

    finishCurrentLabel(getElapsedMs())
    setCurrentInstruction('Ready')
    setPhaseProgress(0)
    setPhaseSecondsLeft(0)
    phaseStartedAtRef.current = 0
    phaseDurationRef.current = 0
    recordingStartedAtRef.current = 0

    const mediaRecorder = mediaRecorderRef.current

    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop()
    }

    mediaRecorderRef.current = null

    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    analyserRef.current = null

    if (audioContextRef.current) {
      audioContextRef.current.close()
      audioContextRef.current = null
    }

    setIsRecording(false)
  }

  function drawFrame() {
    const canvas = canvasRef.current
    const analyser = analyserRef.current

    if (!canvas || !analyser) {
      return
    }

    const ctx = canvas.getContext('2d')

    if (!ctx) {
      return
    }

    const { width, height } = canvas
    const bufferLength = analyser.frequencyBinCount
    const data = new Uint8Array(bufferLength)

    const draw = () => {
      analyser.getByteFrequencyData(data)

      const imageData = ctx.getImageData(1, 0, width - 1, height)
      ctx.putImageData(imageData, 0, 0)

      for (let i = 0; i < bufferLength; i += 1) {
        const value = data[i]
        const y = height - (i / bufferLength) * height
        const hue = value * 1.5
        const brightness = Math.min(100, value * 0.8)

        ctx.fillStyle = `hsl(${hue}, 100%, ${brightness / 2}%)`
        ctx.fillRect(width - 1, y, 1, height / bufferLength + 1)
      }

      animationFrameRef.current = requestAnimationFrame(draw)
    }

    draw()
  }

  async function startRecording() {
    stopRecording()
    setRecordedBlob(null)
    onRecordingComplete?.(null)
    chunksRef.current = []
    labelsRef.current = []
    instructionIndexRef.current = 0

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    const audioContext = new AudioContext()
    const source = audioContext.createMediaStreamSource(stream)
    const gainNode = audioContext.createGain()
    const analyser = audioContext.createAnalyser()
    const destination = audioContext.createMediaStreamDestination()
    const mediaRecorder = new MediaRecorder(destination.stream)

    gainNode.gain.value = MICROPHONE_GAIN
    analyser.fftSize = FFT_SIZE

    source.connect(gainNode)
    gainNode.connect(analyser)
    gainNode.connect(destination)

    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        chunksRef.current.push(event.data)
      }
    }

    mediaRecorder.onstop = () => {
      if (chunksRef.current.length === 0) {
        return
      }

      const blob = new Blob(chunksRef.current, {
        type: mediaRecorder.mimeType || 'audio/webm',
      })
      const file = new File([blob], `recording-${Date.now()}.webm`, {
        type: blob.type,
      })
      const labels = labelsRef.current.filter((item) => item.durationMs !== null)

      setRecordedBlob(blob)
      chunksRef.current = []
      onRecordingComplete?.({ file, labels })
    }

    streamRef.current = stream
    audioContextRef.current = audioContext
    analyserRef.current = analyser
    mediaRecorderRef.current = mediaRecorder
    recordingStartedAtRef.current = Date.now()

    mediaRecorder.start()
    recordingTimeoutRef.current = setTimeout(stopRecording, MAX_RECORDING_MS)
    progressIntervalRef.current = setInterval(updatePhaseProgress, 100)

    setIsRecording(true)
    scheduleNextInstruction()
    drawFrame()
  }

  useEffect(() => {
    if (!recordedBlob) {
      setAudioUrl(null)
      return
    }

    const nextAudioUrl = URL.createObjectURL(recordedBlob)
    setAudioUrl(nextAudioUrl)

    return () => URL.revokeObjectURL(nextAudioUrl)
  }, [recordedBlob])

  useEffect(() => stopRecording, [])

  return (
    <>
      <button onClick={isRecording ? stopRecording : startRecording}>
        {isRecording ? 'Stop Microphone' : 'Start Microphone'}
      </button>
      <p>{currentInstruction}</p>
      {isRecording && (
        <>
          <div
            style={{
              width: '320px',
              maxWidth: '100%',
              height: '10px',
              backgroundColor: '#ddd',
              borderRadius: '999px',
              overflow: 'hidden',
              marginBottom: '8px',
            }}
          >
            <div
              style={{
                width: `${phaseProgress * 100}%`,
                height: '100%',
                backgroundColor: '#4a90e2',
                transition: 'width 100ms linear',
              }}
            ></div>
          </div>
          <p>{phaseSecondsLeft}s left</p>
        </>
      )}
      <canvas ref={canvasRef} width={CANVAS_WIDTH} height={CANVAS_HEIGHT}></canvas>
      {audioUrl && <audio controls src={audioUrl}></audio>}
    </>
  )
}
