import { useState } from 'react'
import Sidebar from './components/Sidebar.jsx'
import SearchBar from './components/SearchBar.jsx'
import Dashboard from './components/Dashboard.jsx'
import TextToSpeech from './components/TextToSpeech.jsx'
import SpeechToText from './components/SpeechToText.jsx'
import Campaigns from './components/Campaigns.jsx'
import ManageVoices from './components/ManageVoices.jsx'

function App() {
  const [active, setActive] = useState('dashboard')
  const [requestCreateCampaign, setRequestCreateCampaign] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [searchActive, setSearchActive] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')

  const goToCreateCampaign = () => {
    setActive('campaigns')
    setRequestCreateCampaign(true)
  }

  const closeSearch = () => { setSearchActive(false); setSearchQuery('') }

  const isDashboard = active === 'dashboard'

  return (
    <div className="app-shell">
      <Sidebar
        active={active}
        setActive={setActive}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed((c) => !c)}
        searchActive={searchActive}
        onToggleSearch={() => setSearchActive((s) => !s)}
      />
      <div className="app-content-col">
        <SearchBar active={searchActive} query={searchQuery} onQueryChange={setSearchQuery} onClose={closeSearch} />
        <main className={isDashboard ? 'app-main app-main--flush' : 'app-main'}>
          {active === 'dashboard' && <Dashboard onCreateCampaign={goToCreateCampaign} onOpenCampaigns={() => setActive('campaigns')} searchQuery={searchQuery} />}
          {active === 'tts' && <TextToSpeech />}
          {active === 'stt' && <SpeechToText />}
          {active === 'voices' && <ManageVoices />}
          {active === 'campaigns' && (
            <Campaigns
              initialCreate={requestCreateCampaign}
              onConsumeCreate={() => setRequestCreateCampaign(false)}
              onGoToDashboard={() => setActive('dashboard')}
            />
          )}
        </main>
      </div>
    </div>
  )
}

export default App
