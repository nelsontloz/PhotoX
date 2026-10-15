# Core seeds ADMIN_EMAIL/ADMIN_PASSWORD as the admin at bootstrap when no admin exists (open
# registration always mints 'user') — this feature pins both behaviors. Scenario-scoped, so it runs
# in the parallel `suite` project; the users-table check searches instead of assuming page 1.
Feature: Seeded administrator and open registration

  Scenario: The seeded admin signs in as admin
    Given the instance was seeded with an administrator
    When I sign in as "admin@photox.test" through the login page
    Then I am signed in on the timeline
    And my session role is "admin"
    And the sidebar shows the admin link
    And the admin API accepts my session
    And I can open the admin dashboard
    And the users table lists "admin@photox.test"

  Scenario: A registered account is a regular user
    When I sign out
    And I register "user@photox.test" through the register page
    Then my session role is "user"
    And the sidebar does not show the admin link
    And opening "/admin" redirects me to the timeline
