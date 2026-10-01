import { LegalDocument } from '../../components/LegalDocument'
import { usePageTitle } from '../../hooks/usePageTitle'
import { termsOfService } from '../../legal/terms'

export function TermsPage() {
  usePageTitle(termsOfService.title)
  return <LegalDocument doc={termsOfService} other={{ label: 'Privacy Policy', to: '/privacy' }} />
}
