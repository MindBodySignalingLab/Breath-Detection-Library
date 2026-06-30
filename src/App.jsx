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

function App() {
  const [recordingFile, setRecordingFile] = useState(null)
  const [recordingLabels, setRecordingLabels] = useState([])
  const [downloadError, setDownloadError] = useState('')

  function handleRecordingComplete(recording) {
    setRecordingFile(recording?.file ?? null)
    setRecordingLabels(recording?.labels ?? [])
  }

  async function insertData() {
    if (!recordingFile) {
      return
    }

    const filePath = `${FOLDER_NAME}/${recordingFile.name}`

    await supabase.storage.from(BUCKET_NAME).upload(filePath, recordingFile, {
      contentType: recordingFile.type,
      upsert: false,
    })

    const fileUrl = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET_NAME}/${filePath}`

    await supabase.from('audio_meta_data').insert({
      download_link: fileUrl,
      labels: recordingLabels,
    })
  }

  async function downloadAllRecordings() {
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
      setDownloadError(error instanceof Error ? error.message : 'Download failed')
    }
  }

  return (
    <>
      <button onClick={insertData} disabled={!recordingFile}>
        Upload Recording
      </button>
      <button onClick={downloadAllRecordings}>Download All Recordings</button>
      {downloadError && <p>{downloadError}</p>}
      <Spectrogram onRecordingComplete={handleRecordingComplete} />
    </>
  )
}

export default App
