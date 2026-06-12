// Run the groundedness verification layer over a resolved generation.
//
// Verification is two gates in series. First the deterministic one (already done
// during citation resolution): a claim must cite a chunk that was actually
// retrieved and carry a quote that resolves to a real span. Then the judge: the
// quote must actually entail the claim. A claim passes only if both gates pass,
// and the whole answer is "supported" only if every claim passes and the
// deterministic citation pre-check held. An answer with no claims is unsupported
// by definition, which is what turns an abstention into a refusal upstream.

import type { ResolvedGeneration, AnsweredClaim } from "../generation/citations.js";

import type { ClaimVerification, VerificationResult, Verifier } from "./types.js";

// Pick the citation we will judge: the first one that resolved to a real span.
function resolvableCitation(claim: AnsweredClaim) {
  return claim.citations.find((c) => c.chunkFound && c.quoteFound);
}

export async function verifyGeneration(
  resolved: ResolvedGeneration,
  verifier: Verifier,
): Promise<VerificationResult> {
  const claimResults: ClaimVerification[] = [];
  let usedJudge = false;
  let costUsd = 0;

  for (const claim of resolved.claims) {
    const citation = resolvableCitation(claim);
    if (!citation || !citation.span || !citation.provenance) {
      // Nothing concrete to judge: the claim is not deterministically grounded.
      claimResults.push({ claim: claim.text, deterministicOk: false, verified: false });
      continue;
    }

    usedJudge = true;
    const result = await verifier.judge({
      claim: claim.text,
      quote: citation.quote.trim(),
      sectionLabel: citation.provenance.sectionLabel,
    });
    costUsd += result.costUsd;
    claimResults.push({
      claim: claim.text,
      deterministicOk: true,
      judge: result.verdict,
      verified: result.verdict.entailed,
    });
  }

  const everyClaimVerified =
    claimResults.length > 0 && claimResults.every((c) => c.verified);
  const verdict =
    resolved.citationPrecheckPassed && everyClaimVerified ? "supported" : "unsupported";

  return {
    verdict,
    claims: claimResults,
    verifierId: usedJudge ? verifier.id : null,
    costUsd,
  };
}
