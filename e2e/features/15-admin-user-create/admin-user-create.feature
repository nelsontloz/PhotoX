# Admin-created accounts (POST /api/v1/admin/users) are how a closed instance gets users: the
# dialog ignores the public registration switch on purpose. Scenario 3 only mocks the public flag
# on its own page — the real global switch is flipped exclusively by features/00-serial.
Feature: Admin-created accounts

  Scenario: The admin creates a regular account through the dialog
    Given an administrator session is available for account creation
    And a regular account will be created through the dialog
    When the account-creating admin opens the users tab
    And the account-creating admin opens the create-user dialog
    Then the create-user submit stays disabled until every field is valid
    When the account-creating admin submits the new account
    Then the create-user dialog closes with a Created toast
    And the users row shows the created account with its role
    And the created account signs in as a regular user

  Scenario: The admin creates another admin through the dialog
    Given an administrator session is available for account creation
    And an administrator account will be created through the dialog
    When the account-creating admin opens the users tab
    And the account-creating admin opens the create-user dialog
    When the account-creating admin submits the new account
    Then the create-user dialog closes with a Created toast
    And the users row shows the created account with its role
    And the created admin can reach the admin users API
    And the created admin account is removed again

  Scenario: With public sign-ups mocked off the admin still creates an account
    Given the public sign-up flag is mocked off for this page
    Then the login page hides the create-account link
    And the register page shows the closed sign-up notice
    Given an administrator session is available for account creation
    And a regular account will be created through the dialog
    When the account-creating admin opens the users tab
    And the account-creating admin opens the create-user dialog
    When the account-creating admin submits the new account
    Then the admin account create request returned 201
    And the create-user dialog closes with a Created toast
    And the users row shows the created account with its role
