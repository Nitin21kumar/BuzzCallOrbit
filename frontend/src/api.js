import axios from 'axios'

const API_BASE = import.meta.env.VITE_API_BASE_URL || (import.meta.env.DEV ? 'http://localhost:8000' : '')

export const api = axios.create({ baseURL: API_BASE })

// --- Voice Folders (independent of OBD campaigns) ---
export const createVoiceFolder = (name) => api.post('/api/tts/folders', { name })
export const listVoiceFolders = () => api.get('/api/tts/folders')
export const deleteVoiceFolder = (folderId) => api.delete(`/api/tts/folders/${folderId}`)

// --- Text to Speech (voices are scoped per folder) ---
export const generateSpeech = (text, folderId, languages, sourceLanguageCode = 'hi-IN', gender = 'female', temperature = 0.78, pace = 1.0) =>
  api.post('/api/tts/generate', { text, folder_id: folderId, languages, source_language_code: sourceLanguageCode, gender, temperature, pace })
export const getTtsHistory = (folderId) => api.get('/api/tts/history', { params: folderId ? { folder_id: folderId } : {} })
export const getTtsDownloadUrl = (folderId, filename) => `${API_BASE}/api/tts/download/${folderId}/${filename}`
export const deleteVoice = (folderId, languageCode) => api.delete(`/api/tts/${folderId}/${languageCode}`)

// --- Speech to Text ---
export const transcribeAudio = (file, languageCode = 'unknown', translateToEnglish = false) => {
  const form = new FormData()
  form.append('file', file)
  form.append('language_code', languageCode)
  form.append('translate_to_english', translateToEnglish)
  return api.post('/api/stt/transcribe', form)
}
export const getSttHistory = () => api.get('/api/stt/history')

// --- OBD Campaigns ---
export const createCampaign = (name) => api.post('/api/campaigns', { name })
export const listCampaigns = () => api.get('/api/campaigns')
export const deleteCampaign = (id) => api.delete(`/api/campaigns/${id}`)
export const setCampaignVoiceSource = (id, voiceSourceFolderId) =>
  api.patch(`/api/campaigns/${id}/voice-source`, { voice_source_folder_id: voiceSourceFolderId })
export const uploadCampaignAudio = (id, file) => {
  const form = new FormData()
  form.append('file', file)
  return api.post(`/api/campaigns/${id}/upload-audio`, form)
}
export const getCampaignAudioUrl = (id) => `${API_BASE}/api/campaigns/${id}/audio`
export const uploadCampaignContacts = (id, file) => {
  const form = new FormData()
  form.append('file', file)
  return api.post(`/api/campaigns/${id}/upload-contacts`, form)
}
export const deleteCampaignContacts = (id) => api.delete(`/api/campaigns/${id}/contacts`)
export const startCampaign = (id) => api.post(`/api/campaigns/${id}/start`)
export const getCampaignStatus = (id) => api.get(`/api/campaigns/${id}/status`)
export const getCampaignReportUrl = (id) => `${API_BASE}/api/campaigns/${id}/report`
export const getObdOverview = () => api.get('/api/obd/overview')
export const getDailyStats = () => api.get('/api/obd/daily-stats')
export const getCampaignPerformance = () => api.get('/api/obd/campaign-performance')
