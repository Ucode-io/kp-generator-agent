export const DIRECT_SELLER_MANAGEMENT_EVIDENCE_PATTERN = /(?:multi[- ]vendor(?:\s+marketplace)?|third[- ]party\s+sellers?\s+marketplace|seller\s+marketplace|marketplace\s+(?:platform|operator)\s+(?:for|with)\s+(?:third[- ]party\s+)?sellers?|(?:manage|onboard|approve|moderate|administer|verify)\p{L}*(?:\s+(?:and|or)\s+(?:manage|onboard|approve|moderate|administer|verify)\p{L}*)?\s+(?:third[- ]party\s+)?(?:sellers?|vendors?|merchants?)|(?:sellers?|vendors?|merchants?)\s+(?:management|onboarding|approval|moderation|administration|verification))/iu;

const ENGLISH_SELLER_MANAGEMENT_CLAIM_PATTERN = /(?:manage|onboard|approve|moderate|administer|verify)\p{L}*[^.!?]{0,80}(?:sellers?|vendors?|merchants?)|(?:sellers?|vendors?|merchants?)[^.!?]{0,80}(?:management|onboarding|approval|moderation|administration|verification)/iu;
const LOCALIZED_SELLER_MANAGEMENT_CLAIM_PATTERN = /sotuvchi\p{L}*[^.!?]{0,80}(?:boshqar|ulash|tekshir)|(?:boshqar|ulash|tekshir)\p{L}*[^.!?]{0,80}sotuvchi\p{L}*|продавц\p{L}*[^.!?]{0,80}(?:управл|подключ|провер|модерац)|(?:управл|подключ|провер|модерац)\p{L}*[^.!?]{0,80}продавц\p{L}*/iu;

export function assertsSellerManagement(value = "") {
  const text = String(value || "");
  return DIRECT_SELLER_MANAGEMENT_EVIDENCE_PATTERN.test(text)
    || ENGLISH_SELLER_MANAGEMENT_CLAIM_PATTERN.test(text)
    || LOCALIZED_SELLER_MANAGEMENT_CLAIM_PATTERN.test(text);
}

export function hasDirectSellerManagementEvidence(value = "") {
  return DIRECT_SELLER_MANAGEMENT_EVIDENCE_PATTERN.test(String(value || ""));
}
