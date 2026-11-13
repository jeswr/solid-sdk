// AUTHORED-BY Codex GPT-6.1-Sol
/** Common DPV purposes; labels describe intent without inventing a grant purpose. */
const labels: Record<string, string> = {
  AcademicResearch: "Academic research",
  AccountManagement: "Manage your account",
  Advertising: "Show advertising",
  CommercialResearch: "Commercial research",
  CommunicationForCustomerCare: "Customer support",
  CommunicationManagement: "Manage communications",
  CustomerCare: "Customer support",
  CustomerManagement: "Manage customer relationships",
  DeliveryOfGoods: "Deliver goods",
  DirectMarketing: "Direct marketing",
  FraudPreventionAndDetection: "Prevent and detect fraud",
  HumanResourceManagement: "Manage employment",
  IdentityVerification: "Verify your identity",
  ImproveExistingProductsAndServices: "Improve products and services",
  InternalResourceOptimisation: "Improve internal operations",
  LegalCompliance: "Meet legal obligations",
  Marketing: "Marketing",
  NonCommercialResearch: "Non-commercial research",
  OptimisationForConsumer: "Improve your experience",
  PaymentManagement: "Manage payments",
  Personalisation: "Personalise your experience",
  PersonalisedAdvertising: "Personalise advertising",
  PersonalisedBenefits: "Provide personalised benefits",
  ResearchAndDevelopment: "Research and development",
  Security: "Keep services secure",
  ServicePersonalisation: "Personalise the service",
  ServiceProvision: "Provide the service",
  ServiceRegistration: "Register for the service",
  UserInterfacePersonalisation: "Personalise the interface",
  UserInterfaceOptimisation: "Improve the interface",
};
export function dpvPurposeLabel(iri: string): string | undefined {
  const prefix = "https://w3id.org/dpv#";
  const key = iri.slice(prefix.length);
  return iri.startsWith(prefix) && Object.hasOwn(labels, key) ? labels[key] : undefined;
}
