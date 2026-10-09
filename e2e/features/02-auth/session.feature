Feature: Session lifecycle

  Scenario: Signing out through the account menu clears the session
    Given I am signed in
    When I open the timeline and sign out through the account menu
    Then I am on the login page
    And the stored session has no refresh token
    When I open "/"
    Then I am on the login page
