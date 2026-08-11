import axios from 'axios'
import { firebaseAuth } from './lib/firebase.js'

const API_BASE = import.meta.env.VITE_API_BASE_URL || (import.meta.env.DEV ? 'http://localhost:8000' : '')

export const api = axios.create({ baseURL: API_BASE })

// Every request carries the current Firebase ID token, which the backend
// verifies on every protected route (see backend/app/auth.py) — this is
// what actually enforces roles/permissions, not just the frontend UI.
api.interceptors.request.use(async (config) => {
  const user = firebaseAuth.currentUser
  if (user) {
    const token = await user.getIdToken()
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// --- Users & permissions (role-based access control) ---
export const getMyProfile = () => api.get('/api/users/me')
export const listUsers = () => api.get('/api/users')
export const createUser = (payload) => api.post('/api/users', payload)
export const updateUser = (uid, payload) => api.patch(`/api/users/${uid}`, payload)
export const deleteUser = (uid) => api.delete(`/api/users/${uid}`)

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

// --- WhatsApp OBD ---
export const createWhatsAppCampaign = (name, templateName, templateLanguage, campaignContext, messageText, sourceLanguageCode) =>
  api.post('/api/whatsapp', {
    name, template_name: templateName, template_language: templateLanguage,
    campaign_context: campaignContext, message_text: messageText, source_language_code: sourceLanguageCode,
  })
export const listWhatsAppCampaigns = () => api.get('/api/whatsapp')
export const deleteWhatsAppCampaign = (id) => api.delete(`/api/whatsapp/${id}`)
export const uploadWhatsAppContacts = (id, file) => {
  const form = new FormData()
  form.append('file', file)
  return api.post(`/api/whatsapp/${id}/upload-contacts`, form)
}
export const deleteWhatsAppContacts = (id) => api.delete(`/api/whatsapp/${id}/contacts`)
export const startWhatsAppCampaign = (id) => api.post(`/api/whatsapp/${id}/start`)
export const getWhatsAppCampaignStatus = (id) => api.get(`/api/whatsapp/${id}/status`)
export const getWhatsAppReportUrl = (id) => `${API_BASE}/api/whatsapp/${id}/report`
export const listWhatsAppConversations = () => api.get('/api/whatsapp/conversations')
export const getWhatsAppConversation = (phoneNumber) => api.get(`/api/whatsapp/conversations/${encodeURIComponent(phoneNumber)}/messages`)
export const createWhatsAppTemplate = (name, category, languageCode, bodyExample, staticPrefix, staticSuffix) =>
  api.post('/api/whatsapp/templates', { name, category, language_code: languageCode, body_example: bodyExample, static_prefix: staticPrefix, static_suffix: staticSuffix })
export const listWhatsAppTemplates = () => api.get('/api/whatsapp/templates')

// --- WhatsApp Inbound: keyword rules, AI knowledge base, conversation status/handoff ---
export const listKeywordRules = () => api.get('/api/whatsapp/keyword-rules')
export const createKeywordRule = (keyword, replyText, matchType) =>
  api.post('/api/whatsapp/keyword-rules', { keyword, reply_text: replyText, match_type: matchType })
export const deleteKeywordRule = (id) => api.delete(`/api/whatsapp/keyword-rules/${id}`)
export const getWhatsAppSettings = () => api.get('/api/whatsapp/settings')
export const updateWhatsAppSettings = (knowledgeBase) => api.put('/api/whatsapp/settings', { knowledge_base: knowledgeBase })
export const setConversationStatus = (phoneNumber, status) =>
  api.patch(`/api/whatsapp/conversations/${encodeURIComponent(phoneNumber)}/status`, { status })
export const setConversationHandoff = (phoneNumber, handoff) =>
  api.patch(`/api/whatsapp/conversations/${encodeURIComponent(phoneNumber)}/handoff`, { handoff })
export const sendManualMessage = (phoneNumber, text) =>
  api.post(`/api/whatsapp/conversations/${encodeURIComponent(phoneNumber)}/send`, { text })
export const getHandoffCount = () => api.get('/api/whatsapp/handoff-count')
