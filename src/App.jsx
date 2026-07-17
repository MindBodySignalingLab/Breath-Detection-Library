import { useState } from 'react'
import { createClient } from '@supabase/supabase-js'
import JSZip from 'jszip'
import { Spectrogram } from './Spectrogram'
import './App.css'

const SUPABASE_URL = 'https://yxbsthipobdgwwqiwixr.supabase.co'
const SUPABASE_KEY = 'sb_publishable_kUJzrkhD6waN4kYfh_7oGw_kR3GgMxB'
const BUCKET_NAME = 'breath-humming-audio'
const FOLDER_NAME = 'public'
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)
const MODES = {
  breathing: {
    key: 'breathing',
    label: 'Breathing',
    uploadLabel: 'breathing recording',
    uploadButton: 'Upload Breathing Recording',
    helperText: 'Record a breathing sample first to enable upload.',
    type: false,
  },
  humming: {
    key: 'humming',
    label: 'Humming',
    uploadLabel: 'humming recording',
    uploadButton: 'Upload Humming Recording',
    helperText: 'Record a humming sample first to enable upload.',
    type: true,
  },
}

function App() {
  const [recordingFile, setRecordingFile] = useState(null)
  const [recordingLabels, setRecordingLabels] = useState([])
  const [recordingMode, setRecordingMode] = useState(MODES.breathing.key)
  const [downloadError, setDownloadError] = useState('')
  const [uploadMessage, setUploadMessage] = useState('')
  const [isUploading, setIsUploading] = useState(false)
  const [isDownloading, setIsDownloading] = useState(false)
  const selectedMode = MODES[recordingMode]

  function handleRecordingComplete(recording) {
    setRecordingFile(recording?.file ?? null)
    setRecordingLabels(recording?.labels ?? [])
    if (recording?.mode) {
      setRecordingMode(recording.mode)
    }
    setUploadMessage('')
  }

  async function insertData() {
    if (!recordingFile || isUploading) {
      return
    }

    setIsUploading(true)
    setUploadMessage('')

    try {
      const filePath = `${FOLDER_NAME}/${recordingFile.name}`

      await supabase.storage.from(BUCKET_NAME).upload(filePath, recordingFile, {
        contentType: recordingFile.type,
        upsert: false,
      })

      const fileUrl = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET_NAME}/${filePath}`

      await supabase.from('audio_meta_data').insert({
        download_link: fileUrl,
        labels: recordingLabels,
        type: selectedMode.type,
      })

      setUploadMessage(`${selectedMode.label} recording uploaded successfully.`)
    } catch (error) {
      console.error(error)
      setUploadMessage(error instanceof Error ? error.message : 'Upload failed.')
    } finally {
      setIsUploading(false)
    }
  }

  async function downloadAllRecordings() {
    if (isDownloading) {
      return
    }

    setIsDownloading(true)
    setDownloadError('')

    try {
      const { data: files, error: listError } = await supabase.storage.from(BUCKET_NAME).list(FOLDER_NAME)

      if (listError) {
        throw new Error(`Could not list files: ${listError.message}`)
      }

      if (!files?.length) {
        throw new Error(`No files found in ${BUCKET_NAME}/${FOLDER_NAME}`)
      }

      const zip = new JSZip()

      await Promise.all(
        files.map(async (file) => {
          const fileUrl = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET_NAME}/${FOLDER_NAME}/${file.name}`
          const response = await fetch(fileUrl)

          if (!response.ok) {
            throw new Error(`Could not download ${file.name}: ${response.status} ${response.statusText}`)
          }

          const blob = await response.blob()
          zip.file(file.name, blob)
        })
      )

      const zipBlob = await zip.generateAsync({ type: 'blob' })
      const zipUrl = URL.createObjectURL(zipBlob)
      const link = document.createElement('a')

      link.href = zipUrl
      link.download = 'recordings.zip'
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(zipUrl)
    } catch (error) {
      console.error(error)
      setDownloadError(error instanceof Error ? error.message : 'Download failed.')
    } finally {
      setIsDownloading(false)
    }
  }

  const uploadCard = (className = '') => (
    <article className={`info-card upload-card ${className}`.trim()}>
      <button
        className="button button-primary upload-button"
        type="button"
        onClick={insertData}
        disabled={!recordingFile || isUploading}
      >
        {isUploading ? `Uploading ${selectedMode.uploadLabel}...` : selectedMode.uploadButton}
      </button>
      <p className="helper-text">
        {recordingFile
          ? `Your ${selectedMode.uploadLabel} is ready. Upload it now to contribute.`
          : selectedMode.helperText}
      </p>
      {uploadMessage && <p className="status-text" role="status">{uploadMessage}</p>}
    </article>
  )

  return (
    <main className="page-shell">
      <section className="hero section">
        <div className="hero-copy">
          <h1>Breath Detection Data Collection</h1>
          <p className="hero-text">
            At The Verse, we’re building an open source dataset and detection library for breath and humming detection. This project grows with every contribution. By recording a breath and humming sample, you’ll help create a resource that makes wellness-focused interactive experiences more accessible. We’re excited to build it together.
          </p>
        </div>
      </section>

      <section className="section">
        <div className="section-heading">
          <p className="eyebrow">How it works</p>
          <h2>Simple flow for contributors and researchers</h2>
        </div>
        <div className="steps-grid">
          <article className="step-card">
            <span className="step-number">1</span>
            <h3>Choose a recording mode</h3>
            <p>Pick breathing or humming, then follow the guided prompts while the app records audio.</p>
          </article>
          <article className="step-card">
            <span className="step-number">2</span>
            <h3>Review and upload</h3>
            <p>Listen back to the recording and upload the labeled sample to the shared dataset.</p>
          </article>
          <article className="step-card">
            <span className="step-number">3</span>
            <h3>Download for research</h3>
            <p>Researchers can download public recordings directly for analysis, training, and validation.</p>
          </article>
        </div>
      </section>

      <section className="section section-grid" id="recording-workspace">
        <div className="section-heading">
          <h2> Help us collect more data </h2>
        </div>
        <div className="mode-toggle" role="tablist" aria-label="Recording mode">
          {Object.values(MODES).map((mode) => (
            <button
              key={mode.key}
              className={`button ${recordingMode === mode.key ? 'button-primary' : 'button-secondary'}`}
              type="button"
              onClick={() => setRecordingMode(mode.key)}
              aria-pressed={recordingMode === mode.key}
            >
              {mode.label} Mode
            </button>
          ))}
        </div>
        <Spectrogram
          mode={recordingMode}
          onRecordingComplete={handleRecordingComplete}
          uploadAction={uploadCard('mobile-upload-card')}
        />
      </section>

      <section className="section section-grid">
        <div className="section-heading">
          <p className="eyebrow">Dataset actions</p>
          <h2>Upload new samples or download public recordings</h2>
          <p>One path is for contributors adding labeled data. The other is for researchers using it.</p>
        </div>
        <div className="action-grid">
          {uploadCard('desktop-upload-card')}

          <article className="info-card">
            <h3>Download Open Recordings</h3>
            <p>
              Access publicly available recordings directly from the dataset for research and development.
            </p>
            <button
              className="button button-secondary"
              type="button"
              onClick={downloadAllRecordings}
              disabled={isDownloading}
            >
              {isDownloading ? 'Preparing Download...' : 'Download All Recordings'}
            </button>
            <p className="helper-text">Downloads the current public recordings as a single ZIP file.</p>
            {downloadError && <p className="status-text status-text-error">{downloadError}</p>}
          </article>
        </div>
      </section>

      <section className="section footer-panel">
        <p className="footer-contribution">Contribute to the Future of Games For Health &amp; Wellbeing</p>
        <p className="eyebrow">Open research</p>
        <h2>Built to support breath-detection research as an open-source workflow.</h2>
        <p>
          This project helps collect guided breathing exercise data, attach labels to each phase, and
          make public recordings easy to reuse.
        </p>
      </section>
    </main>
  )
}

export default App
