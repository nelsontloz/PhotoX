Feature: Managing my public share links

  Scenario: A fresh account sees the empty shared links state
    Given I am signed in
    When I open "/shared"
    Then the share list shows the empty state

  Scenario: Creating an album share from the album page lists it on the shared page
    Given I am signed in
    When I upload "photo.jpg"
    And I prepare an album share target with the uploaded photo
    And I open the album detail for that share target
    When I create an album share from the album options
    Then the album page confirms the share link was copied
    And the shares API lists that share without a usable token
    When I open "/shared"
    Then the share list shows an album share entry

  Scenario: Creating an asset share from the viewer lists it on the shared page
    Given I am signed in
    When I upload "photo.jpg"
    And I click the photo thumbnail
    When I create an asset share from the viewer
    Then the shares API lists that share without a usable token
    When I open "/shared"
    Then the share list shows an asset share entry

  Scenario: Revoking a share from the shared page makes its link stop working
    Given I am signed in
    When I upload "photo.jpg"
    And I create an asset share for the uploaded photo
    When I open "/shared"
    Then the share list shows an asset share entry
    When I revoke that share from the share list
    Then the share list no longer lists that share
    And the shares API does not list that share
    When an anonymous client calls the public share API for that share
    Then the response status is 404

  Scenario: A trashed photo's share disappears while its album share remains
    Given I am signed in
    When I upload "photo.jpg"
    And I prepare an album share target with the uploaded photo
    And I create an album share for that share target
    And I create an asset share for the uploaded photo
    When I trash the uploaded share photo via the API
    And I open "/shared"
    Then the share list shows only the album share
