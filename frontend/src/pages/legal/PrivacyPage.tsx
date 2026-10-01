import { LegalDocument } from '../../components/LegalDocument'
import { usePageTitle } from '../../hooks/usePageTitle'
import { privacyPolicy } from '../../legal/privacy'

export function PrivacyPage() {
  usePageTitle(privacyPolicy.title)
  return <LegalDocument doc={privacyPolicy} other={{ label: 'Terms of Service', to: '/terms' }} />
}
