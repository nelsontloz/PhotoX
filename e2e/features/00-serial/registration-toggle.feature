# Serial by necessity: `registration.enabled` is one global row, and every parallel feature
# registers users. This feature runs in the `setup` project (workers: 1, alphabetically first)
# and restores the flag in an After hook even when the scenario fails midway.
Feature: Public sign-up switch

  Scenario: Closing public sign-ups keeps admin-created accounts working
    Given an administrator session is available for the sign-up switch
    When the sign-up-switch admin opens the users tab
    And the sign-up-switch admin turns public sign-ups off
    Then the sign-up switch reads off and stays off after a reload
    And the public registration endpoint reports sign-ups closed
    And an anonymous registration is refused with 403
    And the admin can still create an account while sign-ups are closed
    And a fresh visitor sees no create-account link and a closed register page
    When the sign-up-switch admin turns public sign-ups back on
    Then the login page offers the create-account link again
    And an anonymous registration succeeds again
