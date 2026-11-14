# The resumable session API (api/v1/uploads) is mobile-facing — the web client still uploads
# through POST /api/v1/files. These scenarios drive the sessions API directly (raw part PUTs via
# the Playwright request context) and verify the completed asset through the timeline UI.
Feature: Chunked resumable upload sessions

  Scenario: A chunked upload session completes into a visible asset
    Given I am signed in
    When I create a chunked upload session for "photo.jpg"
    And I upload every part of "photo.jpg"
    Then the upload session reports the received part indices
    When I complete the upload session
    Then the timeline shows its loaded thumbnail
    And the session status reports completed with its asset id
